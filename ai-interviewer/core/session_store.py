import uuid
from typing import Optional
from datetime import datetime

# Global session store — dict keyed by session_id
# Each value is a full session dict
_sessions: dict = {}


def create_session(meta: dict, question_bank: list) -> str:
    session_id = str(uuid.uuid4())
    _sessions[session_id] = {
        "session_id": session_id,
        "created_at": datetime.utcnow().isoformat(),
        "meta": meta,                    # job, resume, rubric, difficulty
        "question_bank": question_bank,  # all generated questions
        "asked_question_ids": [],        # ids already asked
        "current_question": question_bank[0] if question_bank else None,
        "conversation": [],              # list of answered Q&A with all signals
        "topic_coverage": {              # how many times each category probed
            "technical_depth": 0,
            "problem_solving": 0,
            "communication_clarity": 0,
            "confidence": 0,
            "cultural_fit": 0,
        },
        "status": "ongoing",             # ongoing | complete
        "last_quality": "unknown",       # quality of last answer for adaptive logic
        "start_time": datetime.utcnow().isoformat(),
        "end_time": None,
    }
    return session_id


def get_session(session_id: str) -> Optional[dict]:
    return _sessions.get(session_id)


def update_session(session_id: str, updates: dict):
    if session_id in _sessions:
        _sessions[session_id].update(updates)


def append_conversation_entry(session_id: str, entry: dict):
    if session_id in _sessions:
        _sessions[session_id]["conversation"].append(entry)


def increment_topic_coverage(session_id: str, category: str):
    if session_id in _sessions:
        coverage = _sessions[session_id]["topic_coverage"]
        if category in coverage:
            coverage[category] += 1


def mark_question_asked(session_id: str, question_id: int):
    if session_id in _sessions:
        _sessions[session_id]["asked_question_ids"].append(question_id)


def get_remaining_questions(session_id: str) -> list:
    session = get_session(session_id)
    if not session:
        return []
    asked = set(session["asked_question_ids"])
    return [q for q in session["question_bank"] if q["id"] not in asked]


def complete_session(session_id: str):
    if session_id in _sessions:
        _sessions[session_id]["status"] = "complete"
        _sessions[session_id]["end_time"] = datetime.utcnow().isoformat()


def delete_session(session_id: str):
    _sessions.pop(session_id, None)
