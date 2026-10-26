import json
import re
from collections import Counter

from core import llm
from prompts.templates import (
    QUESTION_GENERATION_PROMPT,
    SINGLE_QUESTION_GENERATION_PROMPT,
    ADAPTIVE_FOLLOWUP_PROMPT,
    NEXT_QUESTION_SELECTION_PROMPT,
    PER_ANSWER_SCORING_PROMPT,
    FINAL_SUMMARY_PROMPT,
)

# Which model each call uses comes from the signed-in user's settings
# (see core/llm.py): smart=True → evaluation model, otherwise the fast model.

# ── Token budgets — reasoning models need more headroom than non-reasoning ──
# These are the DEFAULT max_tokens for each call site.  The retry logic may
# double these if finish_reason == "length".
DEFAULT_MAX_TOKENS_SMART = 4000
DEFAULT_MAX_TOKENS_FAST  = 2000
SCORE_MAX_TOKENS         = 4000   # score_answer — per-answer scoring JSON
SUMMARY_MAX_TOKENS       = 5000   # generate_final_summary — full report JSON
QUESTION_GEN_MAX_TOKENS  = 4000   # generate_questions — multiple questions
FOLLOWUP_MAX_TOKENS      = 1500   # generate_adaptive_followup — single question


def _is_text_truncated(text: str) -> bool:
    """
    Heuristic: detect if a string field was cut off mid-word / mid-sentence.
    Returns True if the text looks truncated (no terminal punctuation, ends
    mid-word, or contains obvious garbling).
    """
    if not text or not text.strip():
        return False
    text = text.strip()
    # If it ends mid-word (no space before end, and not a known abbreviation)
    if text and not text[-1] in '.!?"\')}' and not text.endswith(('Mr', 'Mrs', 'Ms', 'Dr', 'Jr', 'Sr', 'Inc', 'Ltd', 'Corp')):
        return True
    # If it ends with an incomplete JSON bracket (malformed)
    if text.endswith((',', ':', '"')):
        return True
    return False


def _validate_result(result: dict, call_name: str = "") -> bool:
    """
    Validate that parsed JSON result doesn't contain truncated string fields.
    Returns True if valid, False if truncated text detected.

    Only NARRATIVE fields are checked (summary, justification, reasoning, ...)
    because those are full sentences that must end with terminal punctuation.
    List items (strengths, weaknesses) are intentionally skipped — the LLM
    frequently produces them without trailing periods, so flagging them causes
    spurious retries on otherwise-perfect responses.
    """
    if not isinstance(result, dict):
        return False

    string_fields = [
        "summary", "justification", "reason", "reasoning",
        "follow_up_question", "follow_up_reason", "confidence_reasoning"
    ]

    for field in string_fields:
        val = result.get(field)
        if isinstance(val, str) and _is_text_truncated(val):
            print(f"      [validation] Truncated '{field}' detected in {call_name}: ...{val[-50:]}")
            return False

    return True


def _call_llm(prompt: str, max_tokens: int = DEFAULT_MAX_TOKENS_SMART, smart: bool = False,
              call_name: str = "", validate: bool = True) -> dict:
    """
    Call the user's chosen model with retry logic.
    - smart=True uses the evaluation model, otherwise the fast routing model
    - Checks for "length" truncation and doubles max_tokens on retry
    - Validates parsed JSON for truncated text fields
    - Configuration problems (bad key, unknown model) fail immediately
    """
    import time
    config = llm.current_config()
    target = config.eval if smart else config.fast
    tag = f"[{target.provider}:{target.model}]"
    last_err = None
    current_max_tokens = max_tokens
    soft_retry_done = False  # heuristic validation gets ONE second chance, then accepted

    for attempt in range(5):  # Up to 5 attempts (base + 4 retries with doubled tokens)
        try:
            raw, truncated = llm.chat(target, prompt, current_max_tokens)

            if truncated:
                print(f"      {tag} WARNING: Response truncated on attempt {attempt+1} "
                      f"with max_tokens={current_max_tokens}. Doubling tokens and retrying...")
                last_err = RuntimeError(f"Response truncated at {current_max_tokens} tokens")
                if attempt < 4:
                    current_max_tokens = min(current_max_tokens * 2, 32000)  # Cap at 32K
                    time.sleep(1)
                continue

            result = llm.parse_json(raw)

            # Heuristic validation for truncated text. This fires when a valid
            # JSON value still contains a mid-word / mid-sentence cut (e.g. a
            # reasoning model that consumed the token budget mid-sentence but
            # still closed the JSON). It is a SOFT signal: retry once with a
            # doubled budget, but ACCEPT afterwards — the heuristic is not
            # always reliable (e.g. list items that legitimately omit periods),
            # so we must never fail the whole interview over it.
            if validate and not _validate_result(result, call_name):
                if not soft_retry_done:
                    soft_retry_done = True
                    print(f"      {tag} WARNING: Possible truncated text detected in parsed JSON on attempt {attempt+1}. "
                          f"Doubling tokens and retrying once...")
                    current_max_tokens = min(current_max_tokens * 2, 32000)
                    time.sleep(1)
                    continue
                print(f"      {tag} NOTE: Possible truncated text persisted after second chance — accepting result.")
                return result

            return result

        except json.JSONDecodeError as e:
            last_err = e
            print(f"      {tag} JSON decode error on attempt {attempt+1}: {e}")
            # Retry on JSON errors — model sometimes outputs clean JSON on second attempt
            if attempt < 4:
                time.sleep(2 ** min(attempt, 3))
            continue
        except llm.AIError as e:
            if not e.retryable:
                raise
            last_err = e
            print(f"      {tag} Error on attempt {attempt+1}: {e.message}")
            if attempt < 4:
                time.sleep(2 ** min(attempt, 3))

    if isinstance(last_err, llm.AIError):
        raise last_err
    raise llm.AIError(f"{target.label} ({target.model}) didn't return a usable answer after retries: {last_err}", 502)


_CATEGORY_HINTS = {
    "technical_depth": "Probe hands-on technical skill: system design, architecture, debugging a specific tool or stack, or a deep-dive on a named project from the resume.",
    "problem_solving": "Present a concrete problem that needs structured thinking: debugging a real scenario, optimizing a system, weighing trade-offs, or making an architecture decision.",
    "communication_clarity": "Ask the candidate to explain a complex topic simply, or to describe how they communicate with stakeholders / non-technical audiences.",
    "confidence": "Test assertiveness and ownership: handling disagreement, owning the outcome of a decision, or stepping up under pressure.",
    "cultural_fit": "Probe teamwork, values, working style, conflict resolution with colleagues, adaptability, or growth mindset.",
}

DEFAULT_RUBRIC = {
    "technical_depth": 35,
    "problem_solving": 25,
    "communication_clarity": 20,
    "confidence": 10,
    "cultural_fit": 10,
}


def _target_category_counts(rubric: dict, num_questions: int) -> dict:
    """Distribute num_questions across weight>0 rubric categories.

    Every category with a positive weight gets at least one question when the
    budget allows; any leftover questions go to the highest-weight categories
    first (largest-remainder style). Returns {category: count}.
    """
    required = [c for c, w in rubric.items() if w > 0] or list(rubric.keys())
    if not required:
        return {}
    base, extra = divmod(max(1, num_questions), len(required))
    counts = {c: base for c in required}
    for c in sorted(required, key=lambda c: rubric.get(c, 0), reverse=True)[:extra]:
        counts[c] += 1
    return counts


def _normalize_question_categories(questions: list, rubric: dict, counts: dict) -> None:
    """Deterministically fix question categories so every weight>0 category
    receives the questions it was promised (and no unknown category survives).

    Invalid categories and excess duplicates are reassigned to the most
    under-covered required category (missing categories get priority).
    """
    valid = set(rubric.keys())
    current = Counter(q.get("category", "") for q in questions)

    def deficit(c):
        return counts.get(c, 0) - current[c]

    reassignable = []
    for q in questions:
        cat = q.get("category")
        if cat not in valid or (cat in valid and current[cat] > counts.get(cat, 0)):
            reassignable.append(q)

    for q in reassignable:
        old = q.get("category")
        if old in valid:
            current[old] -= 1
        target = max(valid, key=deficit)
        if deficit(target) > 0:
            q["category"] = target
            current[target] += 1


def _generate_single_question(job_title, job_description, candidate_resume, difficulty, category) -> dict:
    """Generate exactly one targeted question for a missing rubric category."""
    prompt = SINGLE_QUESTION_GENERATION_PROMPT.format(
        job_title=job_title,
        job_description=job_description,
        candidate_resume=candidate_resume,
        difficulty=difficulty,
        category=category,
        category_hint=_CATEGORY_HINTS.get(category, "Focus on this rubric category."),
    )
    result = _call_llm(
        prompt,
        max_tokens=QUESTION_GEN_MAX_TOKENS,
        smart=True,
        call_name=f"generate_single_question:{category}",
    )
    q = result.get("question")
    if not isinstance(q, dict):
        raise RuntimeError(f"Single-question response missing 'question' for {category}")
    q.setdefault("category", category)
    q.setdefault("skill_tested", category)
    q.setdefault("difficulty", difficulty)
    q.setdefault("question_source", "tailored")
    q.setdefault("expected_answer_duration_seconds", 90)
    q.setdefault("follow_ups", [])
    return q


def _backfill_missing_categories(job_title, job_description, candidate_resume, difficulty,
                                 questions: list, rubric: dict, counts: dict) -> list:
    """Generate targeted questions for any promised category that is still
    missing after normalization. Never raises — a failed backfill just logs."""
    current = Counter(q.get("category", "") for q in questions)
    added = []
    for cat in counts:
        if counts[cat] <= 0 or current[cat] >= counts[cat]:
            continue
        try:
            single = _generate_single_question(
                job_title, job_description, candidate_resume, difficulty, cat
            )
            if single.get("category", cat) != cat:
                single["category"] = cat
            questions.append(single)
            added.append(cat)
        except Exception as e:
            print(f"      [backfill] Failed to generate {cat} question: {e}")
    return added


def generate_questions(
    job_title, job_description, candidate_resume, num_questions, interview_type, difficulty, rubric=None
):
    if not rubric:
        rubric = DEFAULT_RUBRIC
    counts = _target_category_counts(rubric, num_questions)

    count_lines = "\n".join(
        f"- {cat}: {counts[cat]} question{'s' if counts[cat] != 1 else ''}"
        for cat in sorted(counts, key=lambda c: counts[c], reverse=True)
        if counts[cat] > 0
    )

    prompt = QUESTION_GENERATION_PROMPT.format(
        job_title=job_title,
        job_description=job_description,
        candidate_resume=candidate_resume,
        num_questions=num_questions,
        interview_type=interview_type,
        difficulty=difficulty,
        category_counts=count_lines,
    )
    result = _call_llm(prompt, max_tokens=QUESTION_GEN_MAX_TOKENS, smart=True, call_name="generate_questions")
    questions = result["questions"]

    _normalize_question_categories(questions, rubric, counts)
    added = _backfill_missing_categories(
        job_title, job_description, candidate_resume, difficulty, questions, rubric, counts
    )
    if added:
        print(f"      [backfill] Added targeted questions for: {', '.join(added)}")

    return questions


def generate_adaptive_followup(question, answer, quality, gap):
    # Uses fast model — simple task
    return _call_llm(ADAPTIVE_FOLLOWUP_PROMPT.format(
        question=question, answer=answer, quality=quality, gap=gap
    ), max_tokens=FOLLOWUP_MAX_TOKENS, smart=False, call_name="generate_adaptive_followup")


def select_next_question(job_title, difficulty, rubric, topic_coverage, remaining_questions, last_quality, last_category):
    # Uses fast model — simple routing decision
    prompt = NEXT_QUESTION_SELECTION_PROMPT.format(
        job_title=job_title, difficulty=difficulty,
        rubric=json.dumps(rubric), topic_coverage=json.dumps(topic_coverage),
        remaining_questions=json.dumps([{"id": q["id"], "category": q["category"], "skill_tested": q["skill_tested"]} for q in remaining_questions]),
        last_quality=last_quality, last_category=last_category,
    )
    return _call_llm(prompt, max_tokens=DEFAULT_MAX_TOKENS_FAST, smart=False, call_name="select_next_question")


def score_answer(job_title, difficulty, question, answer, audio_signals, video_signals, semantic_similarity: float = -1.0):
    """
    Score a candidate's answer.
    semantic_similarity: cosine similarity between question and answer embeddings (0-1).
                         -1.0 means not available (sentence-transformers not installed).
    """
    # Build a human-readable relevance hint for the LLM
    if semantic_similarity >= 0:
        if semantic_similarity < 0.15:
            relevance_hint = f"{semantic_similarity:.2f}/1.0 — answer appears OFF-TOPIC (very low similarity to the question)"
        elif semantic_similarity < 0.30:
            relevance_hint = f"{semantic_similarity:.2f}/1.0 — answer is WEAKLY related to the question"
        else:
            relevance_hint = f"{semantic_similarity:.2f}/1.0 — answer is relevant to the question"
    else:
        relevance_hint = "not computed"

    if video_signals.get("video_available", True):
        video_note = ""
    else:
        reason = video_signals.get("unavailable_reason") or "video analysis unavailable"
        video_note = (
            f" UNAVAILABLE for this answer ({reason}). The numbers below are placeholders, "
            "not measurements — ignore them completely and do not reward or penalise any video behaviour."
        )

    prompt = PER_ANSWER_SCORING_PROMPT.format(
        job_title=job_title, difficulty=difficulty,
        question=question["text"], skill_tested=question.get("skill_tested", "general"),
        category=question.get("category", "general"), answer=answer,
        wpm=audio_signals.get("words_per_minute", "N/A"),
        filler_words=audio_signals.get("filler_words_found", []),
        filler_count=audio_signals.get("filler_word_count", 0),
        pause_count=audio_signals.get("pause_count", 0),
        duration=audio_signals.get("answer_duration_seconds", 0),
        expected_duration=question.get("expected_answer_duration_seconds", 90),
        confidence_lang=audio_signals.get("confidence_language_score", "N/A"),
        hedging_count=audio_signals.get("hedging_count", 0),
        # Basic video
        eye_contact=video_signals.get("eye_contact_percentage", "N/A"),
        expression_score=video_signals.get("avg_expression_score", "N/A"),
        posture_score=video_signals.get("posture_score", "N/A"),
        nervousness=video_signals.get("nervousness_indicators", []),
        engagement=video_signals.get("engagement_score", "N/A"),
        # Rich video signals — now actually sent to LLM
        attention_arc=video_signals.get("attention_arc", "unknown"),
        dominant_position=video_signals.get("dominant_position", "unknown"),
        gesture_frequency=video_signals.get("gesture_frequency", 0.0),
        drowsiness_score=video_signals.get("drowsiness_score", 0.0),
        fatigue_trajectory=video_signals.get("fatigue_trajectory", "none"),
        yawn_count=video_signals.get("yawn_count", 0),
        looking_down_pct=video_signals.get("looking_down_pct", 0.0),
        head_movement_pattern=video_signals.get("head_movement_pattern", "unknown"),
        look_away_count=len(video_signals.get("look_away_events", [])),
        glasses_detected=video_signals.get("glasses_detected", False),
        semantic_similarity=relevance_hint,
        video_note=video_note,
    )
    return _call_llm(prompt, max_tokens=SCORE_MAX_TOKENS, smart=True, call_name="score_answer")


def generate_final_summary(job_title, difficulty, candidate_name, full_transcript, rubric, weighted_scores, overall_score,
                            questions_answered=0, total_questions=0, completion_pct=100.0):
    prompt = FINAL_SUMMARY_PROMPT.format(
        job_title=job_title, difficulty=difficulty, candidate_name=candidate_name,
        full_transcript=full_transcript, rubric=json.dumps(rubric),
        weighted_scores=json.dumps(weighted_scores), overall_score=round(overall_score, 1),
        questions_answered=questions_answered, total_questions=total_questions,
        completion_pct=round(completion_pct, 1),
    )
    return _call_llm(prompt, max_tokens=SUMMARY_MAX_TOKENS, smart=True, call_name="generate_final_summary")


def detect_experience_level(job_description: str, resume_text: str) -> dict:
    prompt = f"""Analyze this job description and candidate resume.
Return JSON with:
- "difficulty": one of "junior" (0-2 yrs exp required), "mid" (2-5 yrs), "senior" (5+ yrs)
- "interview_type": one of "technical" (heavy coding/systems design), "behavioral" (soft skills focus), "mixed"
- "reasoning": 1 sentence explanation

Job Description:
{job_description[:2000]}

Resume:
{resume_text[:1500] if resume_text and resume_text.strip() else "No resume provided."}

JSON only, no other text:"""
    try:
        result = _call_llm(prompt, max_tokens=500, call_name="detect_experience_level", validate=False)
        if result.get("difficulty") not in ("junior", "mid", "senior"):
            result["difficulty"] = "mid"
        if result.get("interview_type") not in ("technical", "behavioral", "mixed"):
            result["interview_type"] = "mixed"
        return result
    except Exception:
        return {"difficulty": "mid", "interview_type": "mixed", "reasoning": "Using defaults."}