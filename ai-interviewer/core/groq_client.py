import json
import os
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


def _call_groq(prompt: str, max_tokens: int = 2000, smart: bool = False) -> dict:
    import time
    model = MODEL_SMART if smart else MODEL_FAST
    last_err = None
    for attempt in range(3):
        try:
            response = client.chat.completions.create(
                model=model,
                max_tokens=max_tokens,
                messages=[
                    {
                        "role": "system",
                        "content": "You are an expert AI interviewer. Always respond with valid JSON only. No extra text, no markdown, no code fences.",
                    },
                    {"role": "user", "content": prompt},
                ],
                temperature=0.4,
            )
            raw = response.choices[0].message.content.strip()
            # Strip markdown code fences
            if raw.startswith("```"):
                raw = raw.split("```", 2)[1]
                if raw.lower().startswith("json"):
                    raw = raw[4:].lstrip()
            return json.loads(raw.strip())
        except json.JSONDecodeError as e:
            last_err = e
            # Retry on JSON errors — model sometimes outputs clean JSON on second attempt
            if attempt < 2:
                time.sleep(2 ** attempt)
            continue
        except Exception as e:
            last_err = e
            if attempt < 2:
                time.sleep(2 ** attempt)
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
    result = _call_groq(prompt, max_tokens=3000, smart=True)
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
    ), smart=False)


def select_next_question(job_title, difficulty, rubric, topic_coverage, remaining_questions, last_quality, last_category):
    # Uses fast model — simple routing decision
    prompt = NEXT_QUESTION_SELECTION_PROMPT.format(
        job_title=job_title, difficulty=difficulty,
        rubric=json.dumps(rubric), topic_coverage=json.dumps(topic_coverage),
        remaining_questions=json.dumps([{"id": q["id"], "category": q["category"], "skill_tested": q["skill_tested"]} for q in remaining_questions]),
        last_quality=last_quality, last_category=last_category,
    )
    return _call_groq(prompt, smart=False)


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
    return _call_groq(prompt, max_tokens=1500, smart=True)


def generate_final_summary(job_title, difficulty, candidate_name, full_transcript, rubric, weighted_scores, overall_score,
                            questions_answered=0, total_questions=0, completion_pct=100.0):
    prompt = FINAL_SUMMARY_PROMPT.format(
        job_title=job_title, difficulty=difficulty, candidate_name=candidate_name,
        full_transcript=full_transcript, rubric=json.dumps(rubric),
        weighted_scores=json.dumps(weighted_scores), overall_score=round(overall_score, 1),
        questions_answered=questions_answered, total_questions=total_questions,
        completion_pct=round(completion_pct, 1),
    )
    return _call_groq(prompt, max_tokens=2000, smart=True)


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
        result = _call_groq(prompt, max_tokens=150)
        if result.get("difficulty") not in ("junior", "mid", "senior"):
            result["difficulty"] = "mid"
        if result.get("interview_type") not in ("technical", "behavioral", "mixed"):
            result["interview_type"] = "mixed"
        return result
    except Exception:
        return {"difficulty": "mid", "interview_type": "mixed", "reasoning": "Using defaults."}