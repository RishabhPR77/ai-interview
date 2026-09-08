import os
import subprocess
import tempfile
from fastapi import APIRouter, UploadFile, File, Form, HTTPException, Request
from fastapi.responses import JSONResponse
import json
import numpy as np


def _sanitize(obj):
    """Recursively convert numpy scalars/arrays to native Python types so json.dumps works."""
    if isinstance(obj, dict):
        return {k: _sanitize(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [_sanitize(v) for v in obj]
    if isinstance(obj, np.integer):
        return int(obj)
    if isinstance(obj, np.floating):
        return float(obj)
    if isinstance(obj, np.ndarray):
        return obj.tolist()
    return obj

from models.schemas import StartInterviewRequest, StartInterviewResponse, FinalReport, Rubric
from core import groq_client, session_store, scoring_engine
from analysis import audio_analyzer, video_analyzer

router = APIRouter()


@router.post("/interview/start", response_model=StartInterviewResponse)
async def start_interview(request: StartInterviewRequest):
    rubric_dict = request.rubric.model_dump()
    total = sum(rubric_dict.values())
    if total != 100:
        raise HTTPException(status_code=400, detail=f"Rubric weights must sum to 100, got {total}")

    intro_question = {
        "id": 0,
        "text": (
            f"Welcome, {request.candidate_name}! Let's start with a quick introduction. "
            "Please tell us about yourself — your background, your most recent role, "
            "and what excites you about this opportunity."
        ),
        "category": "communication_clarity",
        "skill_tested": "self-introduction, communication",
        "difficulty": "easy",
        "question_source": "intro",
        "expected_answer_duration_seconds": 120,
        "follow_ups": [],
        "is_intro": True,
    }

    generated = groq_client.generate_questions(
        job_title=request.job_title,
        job_description=request.job_description,
        candidate_resume=request.candidate_resume,
        num_questions=max(1, request.num_questions - 1),
        interview_type=request.interview_type,
        difficulty=request.difficulty,
    )

    if not generated:
        raise HTTPException(status_code=500, detail="Question generation failed")

    for i, q in enumerate(generated):
        q["id"] = i + 1

    questions = [intro_question] + generated

    meta = {
        "job_title": request.job_title,
        "job_description": request.job_description,
        "candidate_name": request.candidate_name,
        "candidate_resume": request.candidate_resume,
        "difficulty": request.difficulty,
        "interview_type": request.interview_type,
        "rubric": rubric_dict,
        "num_questions": request.num_questions,
    }

    session_id = session_store.create_session(meta, questions)
    first_question = questions[0]

    # Mark first question as asked but do NOT increment topic_coverage yet —
    # coverage is incremented only when the answer is actually submitted.
    session_store.mark_question_asked(session_id, first_question["id"])

    return StartInterviewResponse(
        session_id=session_id,
        candidate_name=request.candidate_name,
        question_id=first_question["id"],
        question=first_question["text"],
        category=first_question.get("category", "general"),
        estimated_duration_minutes=request.num_questions * 3,
        total_questions=request.num_questions,
    )


@router.post("/interview/detect-seniority")
async def detect_seniority(request: Request):
    body = await request.json()
    result = groq_client.detect_experience_level(
        job_description=body.get("job_description", ""),
        resume_text=body.get("resume_text", ""),
    )
    return JSONResponse(result)


@router.post("/interview/answer")
async def submit_answer(
    session_id: str = Form(...),
    question_id: int = Form(...),
    video: UploadFile = File(...),
    is_audio_only: bool = Form(False),
):
    session = session_store.get_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    if session["status"] == "complete":
        raise HTTPException(status_code=400, detail="Interview already complete")

    question = next((q for q in session["question_bank"] if q["id"] == question_id), None)
    if not question:
        raise HTTPException(status_code=400, detail=f"Question {question_id} not found")

    suffix = os.path.splitext(video.filename or "answer.mp4")[1] or ".mp4"
    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
        content = await video.read()
        tmp.write(content)
        tmp_path = tmp.name

    audio_signals: dict = {}
    video_signals: dict = {}
    compressed_path = tmp_path
    audio_path = tmp_path

    try:
        if is_audio_only:
            # Audio-only submission — skip video compression/analysis.
            # Convert the raw audio (webm/ogg) to WAV so librosa can reliably
            # decode it, then transcribe directly.
            print(f"\n[0/2] Audio-only submission received — skipping video pipeline")
            print(f"\n[1/2] Converting audio to WAV + transcribing with Groq Whisper...")
            audio_path = _extract_audio(tmp_path)
            audio_signals = audio_analyzer.compute_audio_signals(audio_path)
            print(f"      Done. WPM: {audio_signals['words_per_minute']} | Fillers: {audio_signals['filler_word_count']}")
            print(f"      Transcript: {audio_signals['transcript'][:100]}...")

            print(f"[2/2] Scoring answer with Groq...")
            # Video analysis unavailable in audio-only mode — set defaults
            video_signals = _empty_video_signals_audio_only()
            scored_entry = scoring_engine.score_single_answer(
                session=session,
                question=question,
                audio_signals=audio_signals,
                video_signals=video_signals,
            )
            scored_entry["audio_only_submission"] = True
        else:
            print(f"\n[0/4] Compressing video...")
            compressed_path = _compress_video(tmp_path)

            print(f"\n[1/4] Extracting audio from video...")
            audio_path = _extract_audio(compressed_path)

            print("[2/4] Transcribing with Groq Whisper...")
            audio_signals = audio_analyzer.compute_audio_signals(audio_path)
            print(f"      Done. WPM: {audio_signals['words_per_minute']} | Fillers: {audio_signals['filler_word_count']}")
            print(f"      Transcript: {audio_signals['transcript'][:100]}...")

            print("[3/4] Analyzing video with MediaPipe...")
            video_signals = video_analyzer.analyze_video(compressed_path, sample_interval_seconds=0.5)
            print(f"      Done. Eye contact: {video_signals['eye_contact_percentage']}% | Posture: {video_signals['posture_score']}")

            print("[4/4] Scoring answer with Groq...")
            scored_entry = scoring_engine.score_single_answer(
                session=session,
                question=question,
                audio_signals=audio_signals,
                video_signals=video_signals,
            )

    finally:
        import time
        time.sleep(0.3)
        for path in {tmp_path, compressed_path, audio_path}:
            try:
                if path and os.path.exists(path):
                    os.unlink(path)
            except Exception:
                pass

    session_store.append_conversation_entry(session_id, scored_entry)
    # Increment topic coverage when answer is submitted (not at session start)
    if not question.get("is_follow_up", False):
        session_store.increment_topic_coverage(session_id, question.get("category", ""))
    session_store.update_session(
        session_id,
        {"last_quality": "weak" if scored_entry["content_score"] < 5 else "good",
         "current_question": None}
    )

    remaining = [q for q in session_store.get_remaining_questions(session_id) if not q.get("is_follow_up", False)]
    asked_count = len(session["asked_question_ids"])
    total_target = session["meta"]["num_questions"]

    uncovered = sum(1 for cat, count in session["topic_coverage"].items() if count == 0)

    # Allow follow-ups as long as we haven't hit the question limit AND there are remaining questions.
    # Removed the "uncovered == 0" restriction — follow-ups are now allowed even mid-interview
    # when the candidate gives a weak answer on an important topic.
    follow_up_budget = (
        asked_count < total_target
        and len(remaining) > 0
        and not question.get("is_follow_up", False)
    )

    if scored_entry["follow_up_triggered"] and scored_entry.get("follow_up_question") and follow_up_budget:
        next_q_text = scored_entry["follow_up_question"]
        # Use a safe ID: max existing ID + 1 to avoid any collision
        all_ids = [q["id"] for q in session["question_bank"]]
        next_q_id = max(all_ids) + 1

        synthetic_q = {
            "id": next_q_id,
            "text": next_q_text,
            "category": question.get("category", "general"),
            "skill_tested": question.get("skill_tested", "general"),
            "expected_answer_duration_seconds": 90,
            "is_follow_up": True,
        }
        session["question_bank"].append(synthetic_q)
        session_store.mark_question_asked(session_id, next_q_id)
        session_store.update_session(session_id, {"current_question": synthetic_q})

        return JSONResponse({
            "status": "ongoing",
            "question_id": next_q_id,
            "question": next_q_text,
            "category": question.get("category"),
            "is_follow_up": True,
            "questions_remaining": max(0, total_target - asked_count),
            "answer_received": {
                "content_score": scored_entry["content_score"],
                "anomaly_flagged": scored_entry["anomaly_flagged"],
            }
        })

    if remaining and asked_count < total_target:
        coverage = session["topic_coverage"]
        uncovered_cats = {cat for cat, count in coverage.items() if count == 0}
        uncovered_remaining = [q for q in remaining if q.get("category") in uncovered_cats]

        if uncovered_remaining:
            next_q = uncovered_remaining[0]
        elif len(remaining) > 1:
            selection = groq_client.select_next_question(
                job_title=session["meta"]["job_title"],
                difficulty=session["meta"]["difficulty"],
                rubric=session["meta"]["rubric"],
                topic_coverage=session["topic_coverage"],
                remaining_questions=remaining,
                last_quality=session.get("last_quality", "unknown"),
                last_category=question.get("category", ""),
            )
            next_id = selection.get("selected_question_id", remaining[0]["id"])
            next_q = next((q for q in remaining if q["id"] == next_id), remaining[0])
        else:
            next_q = remaining[0]

        session_store.mark_question_asked(session_id, next_q["id"])
        session_store.update_session(session_id, {"current_question": next_q})

        return JSONResponse({
            "status": "ongoing",
            "question_id": next_q["id"],
            "question": next_q["text"],
            "category": next_q.get("category"),
            "is_follow_up": False,
            "questions_remaining": max(0, total_target - asked_count - 1),
            "answer_received": {
                "content_score": scored_entry["content_score"],
                "anomaly_flagged": scored_entry["anomaly_flagged"],
            }
        })

    session_store.complete_session(session_id)
    return JSONResponse({
        "status": "complete",
        "message": "All questions answered. Call POST /interview/end to get the full report.",
        "session_id": session_id,
    })


@router.post("/interview/{session_id}/skip")
async def skip_question(session_id: str, request: Request):
    session = session_store.get_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    if session["status"] == "complete":
        raise HTTPException(status_code=400, detail="Interview already complete")

    body = await request.json()
    question_id = body.get("question_id")
    question = next((q for q in session["question_bank"] if q["id"] == question_id), None)
    if not question:
        raise HTTPException(status_code=400, detail=f"Question {question_id} not found")

    skipped_entry = {
        "question_id": question_id,
        "question_text": question["text"],
        "answer_text": "[Question skipped by candidate]",
        "content_score": 0,
        "communication_score": 0,
        "confidence_score": 0,
        "anomaly_flagged": False,
        "follow_up_triggered": False,
        "skipped": True,
        "category": question.get("category", "general"),
        "audio_signals": None,
        "video_signals": None,
        "justification": "This question was skipped by the candidate.",
    }

    session_store.append_conversation_entry(session_id, skipped_entry)
    if not question.get("is_follow_up", False):
        session_store.increment_topic_coverage(session_id, question.get("category", ""))
    session_store.update_session(session_id, {"last_quality": "weak", "current_question": None})

    remaining = [q for q in session_store.get_remaining_questions(session_id) if not q.get("is_follow_up", False)]
    asked_count = len(session["asked_question_ids"])
    total_target = session["meta"]["num_questions"]

    if remaining and asked_count < total_target:
        coverage = session["topic_coverage"]
        uncovered_cats = {cat for cat, count in coverage.items() if count == 0}
        uncovered_remaining = [q for q in remaining if q.get("category") in uncovered_cats]
        next_q = uncovered_remaining[0] if uncovered_remaining else remaining[0]

        session_store.mark_question_asked(session_id, next_q["id"])
        session_store.update_session(session_id, {"current_question": next_q})

        return JSONResponse({
            "status": "ongoing",
            "question_id": next_q["id"],
            "question": next_q["text"],
            "category": next_q.get("category"),
            "is_follow_up": False,
            "questions_remaining": max(0, total_target - asked_count - 1),
        })

    session_store.complete_session(session_id)
    return JSONResponse({
        "status": "complete",
        "message": "All questions answered. Call POST /interview/end to get the full report.",
        "session_id": session_id,
    })


@router.post("/interview/end")
async def end_interview(session_id: str = Form(...)):
    session = session_store.get_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    if not session["conversation"]:
        session_store.delete_session(session_id)
        return JSONResponse({
            "session_id": session_id,
            "candidate_name": session["meta"]["candidate_name"],
            "job_title": session["meta"]["job_title"],
            "overall_score": 0,
            "recommendation": "no_hire",
            "recommendation_confidence": "none",
            "summary": "Interview was ended before any questions were answered.",
            "strengths": [],
            "weaknesses": [],
            "red_flags": [],
            "breakdown": {},
            "per_question_scores": [],
            "behavioral_heatmap": [],
            "interview_duration_minutes": 0,
            "topic_coverage": session["topic_coverage"],
            "interrupted": True,
        })

    if session["status"] != "complete":
        session_store.complete_session(session_id)

    report = scoring_engine.generate_final_report(session_id)
    session_store.delete_session(session_id)
    return JSONResponse(_sanitize(report))


def _extract_audio(video_path: str) -> str:
    """Extract audio from video using ffmpeg. Uses subprocess for proper error reporting."""
    base = os.path.splitext(video_path)[0]
    audio_path = base + "_audio.wav"
    result = subprocess.run(
        [
            "ffmpeg", "-y", "-i", video_path,
            "-vn", "-acodec", "pcm_s16le", "-ar", "16000", "-ac", "1",
            audio_path, "-loglevel", "error"
        ],
        capture_output=True, text=True
    )
    if result.returncode != 0 or not os.path.exists(audio_path):
        print(f"      WARNING: ffmpeg audio extraction failed — {result.stderr.strip()}")
        print("      Falling back to reading video file directly (quality may be degraded).")
        return video_path
    return audio_path


def _compress_video(input_path: str) -> str:
    """Compress video for faster processing. Uses subprocess for proper error reporting."""
    base = os.path.splitext(input_path)[0]
    compressed_path = base + "_compressed.mp4"
    result = subprocess.run(
        [
            "ffmpeg", "-y", "-i", input_path,
            "-vf", "scale=640:480", "-crf", "28", "-preset", "fast",
            "-c:a", "aac", "-b:a", "64k",
            compressed_path, "-loglevel", "error"
        ],
        capture_output=True, text=True
    )
    if result.returncode != 0 or not os.path.exists(compressed_path):
        print(f"      Compression failed ({result.stderr.strip()}), using original.")
        return input_path
    original_mb   = os.path.getsize(input_path) / (1024 * 1024)
    compressed_mb = os.path.getsize(compressed_path) / (1024 * 1024)
    print(f"      Compressed: {original_mb:.1f}MB → {compressed_mb:.1f}MB")
    return compressed_path


def _empty_video_signals_audio_only() -> dict:
    """Default video signals for audio-only submissions (no video analysis)."""
    return {
        "eye_contact_percentage":  0.0,
        "avg_expression_score":    5.0,
        "posture_score":           5.0,
        "engagement_score":        5.0,
        "posture_breakdown":       {},
        "posture_slump_events":    [],
        "dominant_position":       "unknown",
        "position_breakdown":      {},
        "drowsiness_score":        0.0,
        "yawn_count":              0,
        "yawn_events":             [],
        "fatigue_trajectory":      "none",
        "head_movement_pattern":   "unknown",
        "contempt_detected":       False,
        "disgust_detected":        False,
        "smirk_detected":          False,
        "genuine_smile_pct":       0.0,
        "looking_down_pct":        0.0,
        "micro_expression_events": [],
        "attention_arc":           "unknown",
        "nervousness_indicators":  ["audio_only_mode"],
        "gesture_frequency":       0.0,
        "expression_timeline":     [],
        "look_away_events":        [],
        "glasses_detected":        False,
        "audio_only":              True,
    }