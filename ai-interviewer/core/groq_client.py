import json
import os
import re
from dotenv import load_dotenv
load_dotenv()
from groq import Groq
from prompts.templates import (
    QUESTION_GENERATION_PROMPT,
    ADAPTIVE_FOLLOWUP_PROMPT,
    NEXT_QUESTION_SELECTION_PROMPT,
    PER_ANSWER_SCORING_PROMPT,
    FINAL_SUMMARY_PROMPT,
)

client = Groq(api_key=os.getenv("GROQ_API_KEY"))

# Heavy model for scoring, question generation, and final summary
MODEL_SMART = "openai/gpt-oss-120b"
# Fast lightweight model for simple routing decisions (next question selection, follow-up generation)
MODEL_FAST  = "openai/gpt-oss-20b"

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


def _call_groq(prompt: str, max_tokens: int = DEFAULT_MAX_TOKENS_SMART, smart: bool = False,
               call_name: str = "", validate: bool = True) -> dict:
    """
    Call Groq API with retry logic.
    - Uses reasoning_effort="low" to minimize reasoning token consumption
    - Checks finish_reason for "length" truncation
    - Validates parsed JSON for truncated text fields
    - Doubles max_tokens on truncation and retries
    """
    import time
    model = MODEL_SMART if smart else MODEL_FAST
    last_err = None
    current_max_tokens = max_tokens
    soft_retry_done = False  # heuristic validation gets ONE second chance, then accepted

    for attempt in range(5):  # Up to 5 attempts (base + 4 retries with doubled tokens)
        try:
            response = client.chat.completions.create(
                model=model,
                max_tokens=current_max_tokens,
                reasoning_effort="low",  # Minimize reasoning token consumption
                include_reasoning=False,  # Don't include reasoning in output (saves tokens)
                messages=[
                    {
                        "role": "system",
                        "content": "You are an expert AI interviewer. Always respond with valid JSON only. No extra text, no markdown, no code fences.",
                    },
                    {"role": "user", "content": prompt},
                ],
                temperature=0.4,
            )

            # Check finish_reason for truncation
            finish_reason = response.choices[0].finish_reason
            if finish_reason == "length":
                print(f"      [groq] WARNING: Response truncated (finish_reason=length) on attempt {attempt+1} "
                      f"with max_tokens={current_max_tokens}. Doubling tokens and retrying...")
                last_err = RuntimeError(f"Response truncated at {current_max_tokens} tokens")
                if attempt < 4:
                    current_max_tokens = min(current_max_tokens * 2, 32000)  # Cap at 32K
                    time.sleep(1)
                continue

            raw = response.choices[0].message.content.strip()

            # Strip markdown code fences
            if raw.startswith("```"):
                raw = raw.split("```", 2)[1]
                if raw.lower().startswith("json"):
                    raw = raw[4:].lstrip()

            result = json.loads(raw.strip())

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
                    print(f"      [groq] WARNING: Possible truncated text detected in parsed JSON on attempt {attempt+1}. "
                          f"Doubling tokens and retrying once...")
                    current_max_tokens = min(current_max_tokens * 2, 32000)
                    time.sleep(1)
                    continue
                print(f"      [groq] NOTE: Possible truncated text persisted after second chance — accepting result.")
                return result

            return result

        except json.JSONDecodeError as e:
            last_err = e
            print(f"      [groq] JSON decode error on attempt {attempt+1}: {e}")
            # Retry on JSON errors — model sometimes outputs clean JSON on second attempt
            if attempt < 4:
                time.sleep(2 ** min(attempt, 3))
            continue
        except Exception as e:
            last_err = e
            print(f"      [groq] Error on attempt {attempt+1}: {e}")
            if attempt < 4:
                time.sleep(2 ** min(attempt, 3))

    raise RuntimeError(f"Groq call failed after retries: {last_err}")


def generate_questions(
    job_title, job_description, candidate_resume, num_questions, interview_type, difficulty
):
    prompt = QUESTION_GENERATION_PROMPT.format(
        job_title=job_title,
        job_description=job_description,
        candidate_resume=candidate_resume,
        num_questions=num_questions,
        interview_type=interview_type,
        difficulty=difficulty,
    )
    result = _call_groq(prompt, max_tokens=QUESTION_GEN_MAX_TOKENS, smart=True, call_name="generate_questions")
    questions = result["questions"]

    categories = ["technical_depth", "problem_solving", "communication_clarity", "confidence", "cultural_fit"]
    used_categories = {q.get("category") for q in questions}
    missing = [c for c in categories if c not in used_categories]

    if missing:
        from collections import Counter
        cat_counts = Counter(q.get("category") for q in questions)
        for q in questions:
            if not missing:
                break
            if cat_counts[q.get("category")] > 1:
                cat_counts[q["category"]] -= 1
                q["category"] = missing.pop(0)

    valid_categories = {"technical_depth", "problem_solving", "communication_clarity", "confidence", "cultural_fit"}
    for q in questions:
        if q.get("category") not in valid_categories:
            q["category"] = "cultural_fit"

    return questions


def generate_adaptive_followup(question, answer, quality, gap):
    # Uses fast model — simple task
    return _call_groq(ADAPTIVE_FOLLOWUP_PROMPT.format(
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
    return _call_groq(prompt, max_tokens=DEFAULT_MAX_TOKENS_FAST, smart=False, call_name="select_next_question")


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
    )
    return _call_groq(prompt, max_tokens=SCORE_MAX_TOKENS, smart=True, call_name="score_answer")


def generate_final_summary(job_title, difficulty, candidate_name, full_transcript, rubric, weighted_scores, overall_score,
                            questions_answered=0, total_questions=0, completion_pct=100.0):
    prompt = FINAL_SUMMARY_PROMPT.format(
        job_title=job_title, difficulty=difficulty, candidate_name=candidate_name,
        full_transcript=full_transcript, rubric=json.dumps(rubric),
        weighted_scores=json.dumps(weighted_scores), overall_score=round(overall_score, 1),
        questions_answered=questions_answered, total_questions=total_questions,
        completion_pct=round(completion_pct, 1),
    )
    return _call_groq(prompt, max_tokens=SUMMARY_MAX_TOKENS, smart=True, call_name="generate_final_summary")


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
        result = _call_groq(prompt, max_tokens=500, call_name="detect_experience_level", validate=False)
        if result.get("difficulty") not in ("junior", "mid", "senior"):
            result["difficulty"] = "mid"
        if result.get("interview_type") not in ("technical", "behavioral", "mixed"):
            result["interview_type"] = "mixed"
        return result
    except Exception:
        return {"difficulty": "mid", "interview_type": "mixed", "reasoning": "Using defaults."}