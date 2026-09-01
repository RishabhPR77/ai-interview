from datetime import datetime
from core import groq_client, session_store


# ── Semantic similarity (sentence-transformers, optional) ──────────────────
_similarity_model = None

def _get_similarity_model():
    global _similarity_model
    if _similarity_model is None:
        try:
            from sentence_transformers import SentenceTransformer
            _similarity_model = SentenceTransformer("all-MiniLM-L6-v2")
        except ImportError:
            _similarity_model = False  # mark as unavailable so we don't retry
    return _similarity_model if _similarity_model else None


def compute_semantic_similarity(question_text: str, answer_text: str) -> float:
    """
    Returns cosine similarity between question and answer (0.0 - 1.0).
    Returns -1.0 if sentence-transformers is not installed.
    """
    if not answer_text or not question_text:
        return -1.0
    model = _get_similarity_model()
    if model is None:
        return -1.0
    try:
        from sentence_transformers import util
        import numpy as np
        # Avoid convert_to_tensor — causes failures on Windows CPU with some versions
        q_emb = model.encode(question_text)
        a_emb = model.encode(answer_text)
        # Compute cosine similarity manually (works on plain numpy arrays)
        q_norm = q_emb / (np.linalg.norm(q_emb) + 1e-10)
        a_norm = a_emb / (np.linalg.norm(a_emb) + 1e-10)
        return round(float(np.dot(q_norm, a_norm)), 3)
    except Exception as e:
        print(f"      [similarity] Error: {e}")
        return -1.0


# ── Weighted scoring ───────────────────────────────────────────────────────

def compute_weighted_score(per_question_scores: list[dict], rubric: dict, total_questions: int) -> dict:
    categories = list(rubric.keys())
    category_totals = {cat: [] for cat in categories}

    for q_score in per_question_scores:
        # Skip intro question and skipped questions — no real answer to score
        if q_score.get("is_intro") or q_score.get("skipped"):
            continue
        per_rubric = q_score.get("per_rubric_scores", {})
        q_category = q_score.get("primary_category", "")

        for cat in categories:
            score_val = per_rubric.get(cat)
            if score_val is None:
                continue

            # Only count this question's score for a category if it IS the primary category.
            # Off-category neutral-5 scores are EXCLUDED — they inflate the average unfairly.
            if q_category == cat:
                category_totals[cat].append(score_val)

    # Fallback: if a category has zero primary questions, use all questions that have a score
    # for it (excluding the ones that gave neutral-5 because they weren't primary).
    for cat in categories:
        if not category_totals[cat]:
            for q_score in per_question_scores:
                if q_score.get("is_intro") or q_score.get("skipped"):
                    continue
                per_rubric = q_score.get("per_rubric_scores", {})
                score_val = per_rubric.get(cat)
                # Only include if it's NOT a neutral-5 placeholder (score != 5)
                # OR if there are truly no other options
                if score_val is not None:
                    category_totals[cat].append(score_val)

    category_avgs = {}
    for cat in categories:
        scores = category_totals[cat]
        # Exclude obvious neutral-5 padding if we have real scores
        real_scores = [s for s in scores if s != 5] if len(scores) > 1 else scores
        use_scores = real_scores if real_scores else scores
        category_avgs[cat] = round(sum(use_scores) / len(use_scores), 2) if use_scores else 0.0

    # Weighted overall (0-100)
    # IMPORTANT: untested categories count as 0, NOT excluded-and-rescaled.
    # Rescaling (e.g. "only 20% of the rubric was tested, so multiply by 5")
    # would project a single good answer onto the entire interview, which is
    # dishonest — we have zero evidence for the untested categories.
    overall = 0.0
    for cat, weight in rubric.items():
        overall += (category_avgs.get(cat, 0.0) / 10.0) * weight

    # Completion factor — penalize incomplete interviews much more aggressively.
    # Linear scaling from 0 (no questions answered) to 1 (all questions answered),
    # with a small floor so a single strong answer isn't worth literally zero,
    # but an interview that's mostly skipped can't land anywhere near a normal score.
    answered = len(per_question_scores)
    completion_ratio = min(1.0, answered / max(total_questions, 1))
    completion_factor = 0.15 + (0.85 * completion_ratio)
    overall = round(overall * completion_factor, 1)

    category_avgs["overall"] = overall
    category_avgs["completion_ratio"] = round(completion_ratio * 100, 1)
    return category_avgs


def build_behavioral_heatmap(conversation: list) -> list:
    heatmap = []
    for i, entry in enumerate(conversation):
        audio = entry.get("audio_signals", {}) or {}
        video = entry.get("video_signals", {}) or {}
        heatmap.append({
            "question_index": i,
            "question_id": entry.get("question_id"),
            "confidence_language": audio.get("confidence_language_score", 0),
            "eye_contact_pct": video.get("eye_contact_percentage", 0),
            "posture_score": video.get("posture_score", 0),
            "engagement_score": video.get("engagement_score", 0),
            "nervousness_indicators": video.get("nervousness_indicators", []),
            "filler_word_count": audio.get("filler_word_count", 0),
            "wpm": audio.get("words_per_minute", 0),
            "content_score": entry.get("content_score", 0),
        })
    return heatmap


def score_single_answer(session: dict, question: dict, audio_signals: dict, video_signals: dict) -> dict:
    meta = session["meta"]
    answer_text = audio_signals.get("transcript", "")

    # ── No-speech handling ───────────────────────────────────────────────────
    # If the candidate recorded but said nothing meaningful (silence, mic muted,
    # or just a stray "um"), don't send this to the LLM — an empty/near-empty
    # transcript produces unreliable scores. Score it as a clean zero with a
    # clear justification instead.
    if audio_signals.get("is_silent", False):
        return {
            "question_id": question["id"],
            "question_text": question["text"],
            "answer_text": answer_text,
            "primary_category": question.get("category", ""),
            "is_intro": question.get("is_intro", False),
            "audio_signals": audio_signals,
            "video_signals": video_signals,
            "content_score": 0,
            "communication_score": 0,
            "confidence_score": 0,
            "per_rubric_scores": {},
            "justification": "No spoken answer was detected for this question — the recording contained little to no speech.",
            "anomaly_flagged": True,
            "anomaly_reason": "no_speech_detected",
            "follow_up_triggered": False,
            "follow_up_reason": None,
            "follow_up_question": None,
            "semantic_similarity": -1.0,
        }

    # Compute semantic similarity between question and answer
    semantic_similarity = compute_semantic_similarity(question["text"], answer_text)
    if semantic_similarity >= 0:
        print(f"      Semantic similarity (Q vs A): {semantic_similarity:.3f}")

    scores = groq_client.score_answer(
        job_title=meta["job_title"],
        difficulty=meta["difficulty"],
        question=question,
        answer=answer_text,
        audio_signals=audio_signals,
        video_signals=video_signals,
        semantic_similarity=semantic_similarity,
    )

    follow_up_question = None
    follow_up_triggered = scores.get("follow_up_needed", False)

    if follow_up_triggered:
        fu = groq_client.generate_adaptive_followup(
            question=question["text"],
            answer=answer_text,
            quality="weak" if scores.get("content_score", 5) < 5 else "suspicious",
            gap=scores.get("follow_up_reason", "answer lacked depth"),
        )
        follow_up_question = fu.get("follow_up_question")

    return {
        "question_id": question["id"],
        "question_text": question["text"],
        "answer_text": answer_text,
        "primary_category": question.get("category", ""),
        "is_intro": question.get("is_intro", False),
        "audio_signals": audio_signals,
        "video_signals": video_signals,
        "content_score": scores.get("content_score", 0),
        "communication_score": scores.get("communication_score", 0),
        "confidence_score": scores.get("confidence_score", 0),
        "per_rubric_scores": scores.get("per_rubric_scores", {}),
        "justification": scores.get("justification", ""),
        "anomaly_flagged": scores.get("anomaly_flagged", False),
        "anomaly_reason": scores.get("anomaly_reason"),
        "follow_up_triggered": follow_up_triggered,
        "follow_up_reason": scores.get("follow_up_reason"),
        "follow_up_question": follow_up_question,
        "semantic_similarity": semantic_similarity,
    }


def generate_final_report(session_id: str) -> dict:
    session = session_store.get_session(session_id)
    if not session:
        raise ValueError(f"Session {session_id} not found")

    meta = session["meta"]
    conversation = session["conversation"]
    rubric = meta["rubric"]
    total_questions = meta.get("num_questions", 8)

    weighted_scores = compute_weighted_score(conversation, rubric, total_questions)
    overall_score = weighted_scores.pop("overall", 0.0)
    completion_ratio = weighted_scores.pop("completion_ratio", 100.0)

    heatmap = build_behavioral_heatmap(conversation)

    transcript_lines = []
    for i, entry in enumerate(conversation):
        if entry.get("is_intro") or entry.get("skipped"):
            continue
        transcript_lines.append(
            f"Q{i + 1}: {entry['question_text']}\n"
            f"A: {entry['answer_text']}\n"
            f"Scores: content={entry['content_score']}, "
            f"communication={entry['communication_score']}, "
            f"confidence={entry['confidence_score']}\n"
            f"Notes: {entry['justification']}\n"
        )
    full_transcript = "\n---\n".join(transcript_lines)

    summary_data = groq_client.generate_final_summary(
        job_title=meta["job_title"],
        difficulty=meta["difficulty"],
        candidate_name=meta["candidate_name"],
        full_transcript=full_transcript,
        rubric=rubric,
        weighted_scores=weighted_scores,
        overall_score=overall_score,
        questions_answered=len(conversation),
        total_questions=total_questions,
        completion_pct=completion_ratio,
    )

    # Hard safety net — don't rely on the LLM alone to enforce this.
    # If fewer than half the planned questions were answered, force a
    # non-committal recommendation regardless of what the LLM returned.
    if total_questions > 0 and (len(conversation) / total_questions) < 0.5:
        summary_data["recommendation"] = "maybe"
        summary_data["recommendation_confidence"] = "low"

    start = datetime.fromisoformat(session["start_time"])
    end = datetime.fromisoformat(session.get("end_time") or datetime.utcnow().isoformat())
    duration_minutes = round((end - start).total_seconds() / 60, 1)

    return {
        "session_id": session_id,
        "candidate_name": meta["candidate_name"],
        "job_title": meta["job_title"],
        "overall_score": overall_score,
        "completion_ratio": completion_ratio,
        "recommendation": summary_data.get("recommendation", "maybe"),
        "recommendation_confidence": summary_data.get("recommendation_confidence", "low"),
        "summary": summary_data.get("summary", ""),
        "strengths": summary_data.get("strengths", []),
        "weaknesses": summary_data.get("weaknesses", []),
        "red_flags": summary_data.get("red_flags", []),
        "breakdown": weighted_scores,
        "rubric": rubric,
        "per_question_scores": conversation,
        "behavioral_heatmap": heatmap,
        "interview_duration_minutes": duration_minutes,
        "topic_coverage": session["topic_coverage"],
    }