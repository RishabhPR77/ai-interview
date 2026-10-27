"""
Interview session state, persisted to the database.

Every request (and every background answer job) loads its own copy with
`load()`, mutates it with the helpers below and writes it back with `save()`.
There is deliberately no shared in-memory cache: a background job and a
status poll must never mutate the same dict.

Read-check-write sequences that must not interleave (claiming a question for
analysis, skipping, ending) run under `lock(session_id)`. The lock is
per-process, so run a single instance per database — see the Dockerfile.
"""
import json
import threading
import time
import uuid
from collections import defaultdict
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from typing import Iterator, Optional

from sqlalchemy import delete

from core.db import InterviewSession, SessionLocal, utcnow

_locks: defaultdict[str, threading.Lock] = defaultdict(threading.Lock)
_locks_guard = threading.Lock()
_last_purge = 0.0


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _json_default(obj):
    # numpy scalars / arrays from the analysis layer
    if hasattr(obj, "item") and callable(obj.item):
        try:
            return obj.item()
        except (ValueError, TypeError):
            pass
    if hasattr(obj, "tolist"):
        return obj.tolist()
    raise TypeError(f"Object of type {type(obj).__name__} is not JSON serializable")


@contextmanager
def lock(session_id: str) -> Iterator[None]:
    with _locks_guard:
        session_lock = _locks[session_id]
    with session_lock:
        yield


def save(session: dict) -> None:
    snapshot = json.loads(json.dumps(session, default=_json_default))
    with SessionLocal() as db:
        row = db.get(InterviewSession, session["session_id"])
        if row is None:
            row = InterviewSession(id=session["session_id"], user_id=session["user_id"], data=snapshot)
            db.add(row)
        else:
            row.data = snapshot
        row.updated_at = utcnow()
        db.commit()


def create_session(meta: dict, question_bank: list, user_id: str) -> dict:
    global _last_purge
    # Opportunistic cleanup so long-running servers also drop abandoned interviews.
    if time.monotonic() - _last_purge > 3600:
        _last_purge = time.monotonic()
        purge_stale()
    session = {
        "session_id": str(uuid.uuid4()),
        "user_id": user_id,
        "created_at": _now_iso(),
        "meta": meta,                    # job, resume, rubric, difficulty
        "question_bank": question_bank,  # all generated questions (+ follow-ups as they're asked)
        "asked_question_ids": [],        # ids already asked
        "current_question": None,        # the question the candidate must answer next
        "conversation": [],              # list of answered Q&A with all signals
        "topic_coverage": {              # how many times each category probed
            "technical_depth": 0,
            "problem_solving": 0,
            "communication_clarity": 0,
            "confidence": 0,
            "cultural_fit": 0,
        },
        "follow_ups_used": 0,
        "answer_job": None,              # background analysis of the current answer
        "status": "ongoing",             # ongoing | complete
        "last_quality": "unknown",       # quality of last answer for adaptive logic
        "start_time": _now_iso(),
        "end_time": None,
    }
    return session


def load(session_id: str, user_id: Optional[str] = None) -> Optional[dict]:
    """Fresh copy from the DB. With user_id, returns None for someone else's session."""
    with SessionLocal() as db:
        row = db.get(InterviewSession, session_id)
        if row is None or (user_id is not None and row.user_id != user_id):
            return None
        return json.loads(json.dumps(row.data))


def ask_question(session: dict, question: dict) -> None:
    """Make `question` the one the candidate answers next."""
    session["asked_question_ids"].append(question["id"])
    session["current_question"] = question


def increment_topic_coverage(session: dict, category: str) -> None:
    coverage = session["topic_coverage"]
    if category in coverage:
        coverage[category] += 1


def answered_question_ids(session: dict) -> set:
    return {entry.get("question_id") for entry in session["conversation"]}


def get_remaining_questions(session: dict) -> list:
    asked = set(session["asked_question_ids"])
    return [q for q in session["question_bank"] if q["id"] not in asked and not q.get("is_follow_up")]


def main_questions_asked(session: dict) -> int:
    """Planned questions asked so far — follow-ups don't use up the question budget."""
    by_id = {q["id"]: q for q in session["question_bank"]}
    return sum(1 for qid in session["asked_question_ids"] if not by_id.get(qid, {}).get("is_follow_up"))


def complete_session(session: dict) -> None:
    session["status"] = "complete"
    session["current_question"] = None
    session["end_time"] = _now_iso()


def delete_session(session_id: str) -> None:
    with SessionLocal() as db:
        db.execute(delete(InterviewSession).where(InterviewSession.id == session_id))
        db.commit()
    with _locks_guard:
        _locks.pop(session_id, None)


def purge_stale(max_age_hours: int = 48) -> int:
    """Drop abandoned interviews (no activity for max_age_hours)."""
    cutoff = utcnow() - timedelta(hours=max_age_hours)
    with SessionLocal() as db:
        result = db.execute(delete(InterviewSession).where(InterviewSession.updated_at < cutoff))
        db.commit()
    return result.rowcount or 0
