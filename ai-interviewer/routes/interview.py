import logging
import os
import subprocess
import tempfile
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta

from fastapi import APIRouter, Depends, UploadFile, File, Form, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session
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

from models.schemas import StartInterviewRequest, StartInterviewResponse
from core import llm, llm_client, session_store, scoring_engine
from core.ai_settings import load_ai_config
from core.config import (
    ANALYSIS_WORKERS, ANSWER_JOB_TIMEOUT_SECONDS, MAX_ANSWER_SECONDS, MAX_INTERVIEWS_PER_DAY,
    MAX_UPLOAD_MB, REPORT_RETENTION_HOURS,
)
from core.db import InterviewReport, InterviewSession, UsageEvent, User, as_utc, get_db, utcnow
from core.deps import current_user
from analysis import audio_analyzer, video_analyzer
from analysis.errors import AnalysisError

log = logging.getLogger("tejaskrit.interview")

# Every interview endpoint needs a signed-in user; handlers are plain `def` so
# FastAPI runs blocking work in its threadpool instead of the event loop.
router = APIRouter(dependencies=[Depends(current_user)])

# Answer analysis (ffmpeg + transcription + MediaPipe + scoring) takes far longer
# than proxies allow for one HTTP request, so it runs here and the client polls.
_executor = ThreadPoolExecutor(max_workers=ANALYSIS_WORKERS, thread_name_prefix="answer")


class SeniorityRequest(BaseModel):
    job_description: str = Field(default="", max_length=50_000)
    resume_text: str = Field(default="", max_length=50_000)


class SkipRequest(BaseModel):
    question_id: int


def _conflict(code: str, message: str) -> HTTPException:
    return HTTPException(status_code=409, detail={"code": code, "message": message})


def _owned_session(session_id: str, user: User) -> dict:
    session = session_store.load(session_id, user.id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    return session


def _job_active(session: dict) -> bool:
    job = session.get("answer_job")
    if not job or job.get("state") != "processing":
        return False
    return time.time() - job.get("started_at", 0) < ANSWER_JOB_TIMEOUT_SECONDS


def _check_daily_quota(db: Session, user: User) -> None:
    since = utcnow() - timedelta(hours=24)
    started = db.execute(
        select(func.count()).select_from(UsageEvent)
        .where(UsageEvent.user_id == user.id, UsageEvent.kind == "interview_start", UsageEvent.created_at > since)
    ).scalar_one()
    if started >= MAX_INTERVIEWS_PER_DAY:
        raise HTTPException(status_code=429, detail={
            "code": "daily_limit",
            "message": f"You've started {started} interviews in the last 24 hours — the limit is "
                       f"{MAX_INTERVIEWS_PER_DAY}. Please try again later.",
        })


def _other_answer_in_progress(db: Session, user: User, session_id: str) -> bool:
    """True if another of this user's interviews is currently analysing an answer.
    Video analysis is CPU-heavy, so each user gets one at a time."""
    rows = db.execute(
        select(InterviewSession.data).where(InterviewSession.user_id == user.id, InterviewSession.id != session_id)
    ).scalars()
    return any(_job_active(data) for data in rows)


def _require_current_question(session: dict, question_id: int) -> dict:
    """Only the question currently being asked can be answered or skipped, once.
    Guards against double-submits, retries after a lost response, and stale tabs."""
    if session["status"] == "complete":
        raise HTTPException(status_code=400, detail="Interview already complete")
    if _job_active(session):
        raise _conflict("answer_processing", "Your previous answer is still being analysed.")
    current = session.get("current_question")
    if (not current or current["id"] != question_id
            or question_id in session_store.answered_question_ids(session)):
        raise _conflict("stale_question", "That question was already answered — continuing from where your interview is now.")
    return current


def _state_payload(session: dict) -> dict:
    """Where the interview is now — the shape the client uses to show the next question."""
    if session["status"] == "complete":
        return {
            "status": "complete",
            "message": "All questions answered. Call POST /interview/end to get the full report.",
            "session_id": session["session_id"],
        }
    question = session.get("current_question") or {}
    asked = session_store.main_questions_asked(session)
    return {
        "status": "ongoing",
        "question_id": question.get("id"),
        "question": question.get("text"),
        "category": question.get("category"),
        "is_follow_up": bool(question.get("is_follow_up")),
        "question_number": asked,
        "questions_remaining": max(0, session["meta"]["num_questions"] - asked),
    }


def _advance(session: dict, last_question: dict, follow_up_text: str | None = None, use_llm: bool = True) -> dict:
    """Pick what to ask next (follow-up, next planned question, or finish) and record it."""
    total = session["meta"]["num_questions"]
    asked = session_store.main_questions_asked(session)
    remaining = session_store.get_remaining_questions(session)
    # Follow-ups are extra probes: they don't use up the planned-question budget,
    # but are capped so an interview can't balloon.
    max_follow_ups = max(1, total // 3)

    if (follow_up_text
            and not last_question.get("is_follow_up")
            and not last_question.get("is_intro")
            and session.get("follow_ups_used", 0) < max_follow_ups
            and asked < total and remaining):
        follow_up = {
            "id": max(q["id"] for q in session["question_bank"]) + 1,
            "text": follow_up_text,
            "category": last_question.get("category", "general"),
            "skill_tested": last_question.get("skill_tested", "general"),
            "expected_answer_duration_seconds": 90,
            "is_follow_up": True,
            "parent_question_id": last_question["id"],
        }
        session["question_bank"].append(follow_up)
        session["follow_ups_used"] = session.get("follow_ups_used", 0) + 1
        session_store.ask_question(session, follow_up)
        return _state_payload(session)

    if remaining and asked < total:
        uncovered = {cat for cat, count in session["topic_coverage"].items() if count == 0}
        uncovered_remaining = [q for q in remaining if q.get("category") in uncovered]
        if uncovered_remaining:
            next_q = uncovered_remaining[0]
        elif use_llm and len(remaining) > 1:
            try:
                selection = llm_client.select_next_question(
                    job_title=session["meta"]["job_title"],
                    difficulty=session["meta"]["difficulty"],
                    rubric=session["meta"]["rubric"],
                    topic_coverage=session["topic_coverage"],
                    remaining_questions=remaining,
                    last_quality=session.get("last_quality", "unknown"),
                    last_category=last_question.get("category", ""),
                )
                next_id = selection.get("selected_question_id", remaining[0]["id"])
                next_q = next((q for q in remaining if q["id"] == next_id), remaining[0])
            except llm.AIError as e:
                # Routing is a nicety — never lose a scored answer over it.
                log.warning("next-question selection failed, using bank order: %s", e.message)
                next_q = remaining[0]
        else:
            next_q = remaining[0]
        session_store.ask_question(session, next_q)
        return _state_payload(session)

    session_store.complete_session(session)
    return _state_payload(session)


@router.post("/interview/start", response_model=StartInterviewResponse)
def start_interview(
    request: StartInterviewRequest,
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
):
    ai_config = load_ai_config(db, user.id)
    _check_daily_quota(db, user)
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

    with llm.use_config(ai_config):
        generated = llm_client.generate_questions(
            job_title=request.job_title,
            job_description=request.job_description,
            candidate_resume=request.candidate_resume,
            num_questions=max(1, request.num_questions - 1),
            interview_type=request.interview_type,
            difficulty=request.difficulty,
            rubric=rubric_dict,
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

    session = session_store.create_session(meta, questions, user.id)
    first_question = questions[0]
    # Topic coverage is only incremented once an answer is actually submitted.
    session_store.ask_question(session, first_question)
    session_store.save(session)
    # Only successful starts count toward the daily quota.
    db.add(UsageEvent(user_id=user.id, kind="interview_start"))
    db.commit()

    return StartInterviewResponse(
        session_id=session["session_id"],
        candidate_name=request.candidate_name,
        question_id=first_question["id"],
        question=first_question["text"],
        category=first_question.get("category", "general"),
        estimated_duration_minutes=request.num_questions * 3,
        total_questions=request.num_questions,
    )


@router.post("/interview/detect-seniority")
def detect_seniority(
    body: SeniorityRequest,
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
):
    ai_config = load_ai_config(db, user.id, need_stt=False)
    with llm.use_config(ai_config):
        result = llm_client.detect_experience_level(
            job_description=body.job_description,
            resume_text=body.resume_text,
        )
    return JSONResponse(result)


@router.get("/interview/{session_id}/state")
def interview_state(session_id: str, user: User = Depends(current_user)):
    """Current question / status — lets the client resync after a lost response."""
    session = _owned_session(session_id, user)
    payload = _state_payload(session)
    payload["answer_processing"] = _job_active(session)
    return payload


@router.post("/interview/answer", status_code=202)
def submit_answer(
    session_id: str = Form(...),
    question_id: int = Form(...),
    video: UploadFile = File(...),
    is_audio_only: bool = Form(False),
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
):
    """Accept the recording and start analysing it in the background.
    Poll GET /interview/{session_id}/answer-status?question_id=… for the result."""
    ai_config = load_ai_config(db, user.id)
    # Cheap checks before spending time on the upload.
    _require_current_question(_owned_session(session_id, user), question_id)
    if _other_answer_in_progress(db, user, session_id):
        raise HTTPException(status_code=429, detail={
            "code": "answer_in_progress",
            "message": "Another of your interviews is still analysing an answer. Please wait for it to finish.",
        })

    tmp_path = _save_upload(video)
    duration = _probe_duration(tmp_path)
    if duration is not None and duration > MAX_ANSWER_SECONDS + 5:
        _unlink(tmp_path)
        raise HTTPException(status_code=413, detail={
            "code": "recording_too_long",
            "message": f"That recording is {duration / 60:.1f} minutes long — answers are limited to "
                       f"{MAX_ANSWER_SECONDS // 60} minutes.",
        })
    try:
        # Re-check and claim atomically so a double-submit can't analyse twice.
        with session_store.lock(session_id):
            session = _owned_session(session_id, user)
            _require_current_question(session, question_id)
            session["answer_job"] = {"question_id": question_id, "state": "processing", "started_at": time.time()}
            session_store.save(session)
    except Exception:
        _unlink(tmp_path)
        raise

    _executor.submit(_run_answer_job, session_id, question_id, tmp_path, is_audio_only, ai_config)
    return {"status": "processing", "question_id": question_id}


@router.get("/interview/{session_id}/answer-status")
def answer_status(session_id: str, question_id: int, user: User = Depends(current_user)):
    session = _owned_session(session_id, user)
    job = session.get("answer_job")
    if job and job.get("question_id") == question_id:
        if job["state"] == "processing":
            if _job_active(session):
                return {"status": "processing", "elapsed_seconds": int(time.time() - job["started_at"])}
            message = "Analysing your answer took too long. Please submit it again."
            _fail_job(session_id, question_id, message)
            return {"status": "error", "detail": message}
        if job["state"] == "done":
            return job["result"]
        if job["state"] == "error":
            return {"status": "error", "detail": job.get("error") or "Analysis failed. Please submit again."}
    # No job for this question (e.g. it was answered from another tab): report
    # where the interview is now so the client can resync.
    return _state_payload(session)


def _run_answer_job(session_id: str, question_id: int, tmp_path: str, is_audio_only: bool,
                    ai_config: llm.AIConfig) -> None:
    try:
        with llm.use_config(ai_config):
            session = session_store.load(session_id)
            if session is None:
                return  # interview was deleted meanwhile
            question = session.get("current_question")
            if not question or question["id"] != question_id:
                return
            scored_entry = _analyze_answer(session, question, tmp_path, is_audio_only)

            with session_store.lock(session_id):
                session = session_store.load(session_id)
                job = (session or {}).get("answer_job") or {}
                if job.get("question_id") != question_id or job.get("state") != "processing":
                    return  # timed out and superseded by a re-submission
                session["conversation"].append(scored_entry)
                if not question.get("is_follow_up"):
                    session_store.increment_topic_coverage(session, question.get("category", ""))
                session["last_quality"] = "weak" if scored_entry["content_score"] < 5 else "good"

                follow_up_text = scored_entry.get("follow_up_question") if scored_entry.get("follow_up_triggered") else None
                result = _advance(session, question, follow_up_text=follow_up_text)
                result["answer_received"] = {
                    "content_score": scored_entry["content_score"],
                    "anomaly_flagged": scored_entry["anomaly_flagged"],
                }
                session["answer_job"] = {**job, "state": "done", "result": _sanitize(result)}
                session_store.save(session)
    except (llm.AIError, AnalysisError) as e:
        _fail_job(session_id, question_id, getattr(e, "message", None) or str(e))
    except Exception:
        log.exception("answer analysis failed for session %s question %s", session_id, question_id)
        _fail_job(session_id, question_id, "Something went wrong analysing your answer. Please submit it again.")
    finally:
        _unlink(tmp_path)


def _fail_job(session_id: str, question_id: int, message: str) -> None:
    """Record the failure; the question stays current so the candidate can re-submit."""
    with session_store.lock(session_id):
        session = session_store.load(session_id)
        job = (session or {}).get("answer_job") or {}
        if job.get("question_id") == question_id and job.get("state") == "processing":
            session["answer_job"] = {**job, "state": "error", "error": message}
            session_store.save(session)


def _analyze_answer(session: dict, question: dict, tmp_path: str, is_audio_only: bool) -> dict:
    compressed_path = tmp_path
    audio_path = tmp_path
    try:
        if is_audio_only:
            # Audio-only submission — skip video compression/analysis.
            # Convert the raw audio (webm/ogg) to WAV so librosa can reliably
            # decode it, then transcribe directly.
            print(f"\n[0/2] Audio-only submission received — skipping video pipeline")
            print(f"\n[1/2] Converting audio to WAV + transcribing...")
            audio_path = _extract_audio(tmp_path)
            audio_signals = audio_analyzer.compute_audio_signals(audio_path)
            print(f"      Done. WPM: {audio_signals['words_per_minute']} | Fillers: {audio_signals['filler_word_count']}")
            print(f"      Transcript: {audio_signals['transcript'][:100]}...")

            print(f"[2/2] Scoring answer...")
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

            print("[2/4] Transcribing...")
            audio_signals = audio_analyzer.compute_audio_signals(audio_path)
            print(f"      Done. WPM: {audio_signals['words_per_minute']} | Fillers: {audio_signals['filler_word_count']}")
            print(f"      Transcript: {audio_signals['transcript'][:100]}...")

            print("[3/4] Analyzing video with MediaPipe...")
            video_signals = video_analyzer.analyze_video(compressed_path, sample_interval_seconds=0.5)
            print(f"      Done. Eye contact: {video_signals['eye_contact_percentage']}% | Posture: {video_signals['posture_score']}")

            print("[4/4] Scoring answer...")
            scored_entry = scoring_engine.score_single_answer(
                session=session,
                question=question,
                audio_signals=audio_signals,
                video_signals=video_signals,
            )
        return scored_entry
    finally:
        for path in {compressed_path, audio_path} - {tmp_path}:
            _unlink(path)


@router.post("/interview/{session_id}/skip")
def skip_question(session_id: str, body: SkipRequest, user: User = Depends(current_user)):
    with session_store.lock(session_id):
        session = _owned_session(session_id, user)
        question = _require_current_question(session, body.question_id)

        session["conversation"].append({
            "question_id": question["id"],
            "question_text": question["text"],
            "answer_text": "[Question skipped by candidate]",
            "content_score": 0,
            "communication_score": 0,
            "confidence_score": 0,
            "anomaly_flagged": False,
            "follow_up_triggered": False,
            "skipped": True,
            "is_intro": question.get("is_intro", False),
            "is_follow_up": question.get("is_follow_up", False),
            "category": question.get("category", "general"),
            "audio_signals": None,
            "video_signals": None,
            "justification": "This question was skipped by the candidate.",
        })
        if not question.get("is_follow_up", False):
            session_store.increment_topic_coverage(session, question.get("category", ""))
        session["last_quality"] = "weak"
        result = _advance(session, question, use_llm=False)
        session_store.save(session)
    return result


@router.post("/interview/end")
def end_interview(
    session_id: str = Form(...),
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
):
    with session_store.lock(session_id):
        session = session_store.load(session_id, user.id)
        if session is None:
            # Already ended — e.g. a retry after the first response was lost.
            stored = _stored_report(db, session_id, user)
            if stored is not None:
                return JSONResponse(stored)
            raise HTTPException(status_code=404, detail="Session not found")
        if _job_active(session):
            raise _conflict("answer_processing", "Your last answer is still being analysed — try again in a moment.")

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
            session_store.complete_session(session)
            session_store.save(session)

        with llm.use_config(load_ai_config(db, user.id, need_stt=False)):
            report = _sanitize(scoring_engine.generate_final_report(session))
        report["report_expires_at"] = (utcnow() + timedelta(hours=REPORT_RETENTION_HOURS)).isoformat()
        db.merge(InterviewReport(
            id=session_id, user_id=user.id, data=report,
            expires_at=utcnow() + timedelta(hours=REPORT_RETENTION_HOURS),
        ))
        db.commit()
        session_store.delete_session(session_id)
    return JSONResponse(report)


def _stored_report(db: Session, session_id: str, user: User) -> dict | None:
    row = db.get(InterviewReport, session_id)
    if row is None or row.user_id != user.id or as_utc(row.expires_at) < utcnow():
        return None
    return row.data


@router.get("/interview/{session_id}/report")
def get_report(session_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    """Re-open a finished report (kept for REPORT_RETENTION_HOURS)."""
    report = _stored_report(db, session_id, user)
    if report is None:
        raise HTTPException(status_code=404, detail="This report has expired or doesn't exist.")
    return JSONResponse(report)


def _save_upload(upload: UploadFile) -> str:
    suffix = os.path.splitext(upload.filename or "answer.mp4")[1] or ".mp4"
    if suffix.lower() not in (".webm", ".mp4", ".ogg", ".wav", ".m4a", ".mov"):
        suffix = ".webm"
    max_bytes = MAX_UPLOAD_MB * 1024 * 1024
    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
        tmp_path = tmp.name
        written = 0
        while chunk := upload.file.read(1024 * 1024):
            written += len(chunk)
            if written > max_bytes:
                tmp.close()
                _unlink(tmp_path)
                raise HTTPException(status_code=413, detail=f"Recording is larger than {MAX_UPLOAD_MB} MB")
            tmp.write(chunk)
    return tmp_path


def _probe_duration(path: str) -> float | None:
    """Container duration in seconds, or None when unknown. Browser MediaRecorder
    WebM often has no duration header, so ffmpeg's -t limit is the real backstop."""
    try:
        result = subprocess.run(
            ["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", path],
            capture_output=True, text=True, timeout=20,
        )
        return float(result.stdout.strip())
    except (OSError, ValueError, subprocess.TimeoutExpired):
        return None


def _unlink(path: str | None) -> None:
    try:
        if path and os.path.exists(path):
            os.unlink(path)
    except OSError:
        pass


def _extract_audio(video_path: str) -> str:
    """Extract 16 kHz mono WAV with ffmpeg. Fails loudly: analysing the raw
    container instead tends to produce an empty transcript, which would be
    scored as "no speech" — the candidate must be asked to re-submit instead."""
    base = os.path.splitext(video_path)[0]
    audio_path = base + "_audio.wav"
    result = subprocess.run(
        [
            "ffmpeg", "-y", "-i", video_path, "-t", str(MAX_ANSWER_SECONDS),
            "-vn", "-acodec", "pcm_s16le", "-ar", "16000", "-ac", "1",
            audio_path, "-loglevel", "error"
        ],
        capture_output=True, text=True
    )
    if result.returncode != 0 or not os.path.exists(audio_path):
        print(f"      ERROR: ffmpeg audio extraction failed — {result.stderr.strip()}")
        raise AnalysisError("We couldn't read the audio in your recording. Please submit it again.")
    return audio_path


def _compress_video(input_path: str) -> str:
    """Compress video for faster processing. Uses subprocess for proper error reporting."""
    base = os.path.splitext(input_path)[0]
    compressed_path = base + "_compressed.mp4"
    result = subprocess.run(
        [
            "ffmpeg", "-y", "-i", input_path, "-t", str(MAX_ANSWER_SECONDS),
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
        "nervousness_indicators":  [],
        "gesture_frequency":       0.0,
        "expression_timeline":     [],
        "look_away_events":        [],
        "glasses_detected":        False,
        "audio_only":              True,
        "video_available":         False,
        "unavailable_reason":      "audio-only answer — the camera was off",
    }
