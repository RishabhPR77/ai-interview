"""
Scoring Test — uses the real transcript from test_small.mp4
against a question it actually matches (system design).

Run from ai_interviewer folder:
    python test_scoring.py
"""

import json
import sys
import os
from dotenv import load_dotenv
load_dotenv()

from core import groq_client

TRANSCRIPT = (
    "To design a scalable real-time analytics dashboard, I would like to use a message queue "
    "like Kafka to handle the high volume of incoming events. Data would be processed by "
    "background workers and stored in PostgreSQL with proper indexing for high traffic. "
    "I would like to add a caching layer using Redis to reduce database load and use "
    "horizontal scaling with load balancing on the API layer. For data consistency, I would "
    "use database transactions and event sourcing to ensure no data is lost."
)

# Realistic audio signals matching the video (WPM=120, duration=43s)
AUDIO_SIGNALS = {
    "transcript": TRANSCRIPT,
    "words_per_minute": 120.2,
    "pause_count": 2,
    "filler_word_count": 3,
    "filler_words_found": ["like"],
    "answer_duration_seconds": 43.4,
    "confidence_language_score": 5.7,
    "hedging_count": 0,
}

VIDEO_SIGNALS = {
    "eye_contact_percentage": 100.0,
    "avg_expression_score": 7.0,
    "posture_score": 9.4,
    "nervousness_indicators": [],
    "engagement_score": 8.0,
}

PASS = "\033[92m✓\033[0m"
FAIL = "\033[91m✗\033[0m"

def section(title):
    print(f"\n{'─'*60}")
    print(f"  {title}")
    print(f"{'─'*60}")

def score_and_print(label, question, expected_min_content=5):
    print(f"\n  Question: \"{question['text']}\"")
    print(f"  Category: {question['category']}")

    try:
        result = groq_client.score_answer(
            job_title="Junior Data Science Intern",
            difficulty="junior",
            question=question,
            answer=TRANSCRIPT,
            audio_signals=AUDIO_SIGNALS,
            video_signals=VIDEO_SIGNALS,
        )
    except Exception as e:
        print(f"  ERROR: {e}")
        return None

    content   = result.get("content_score", 0)
    comms     = result.get("communication_score", 0)
    conf      = result.get("confidence_score", 0)
    anomaly   = result.get("anomaly_flagged", False)
    follow_up = result.get("follow_up_needed", False)
    just      = result.get("justification", "")

    ok = content >= expected_min_content
    print(f"  {PASS if ok else FAIL}  Content:       {content}/10  (expected >= {expected_min_content})")
    print(f"       Communication: {comms}/10")
    print(f"       Confidence:    {conf}/10")
    print(f"       Anomaly:       {anomaly}")
    print(f"       Follow-up:     {follow_up}")
    print(f"       Justification: {just[:180]}...")
    print(f"       Rubric scores: {result.get('per_rubric_scores', {})}")
    return result


# ── Test A: Matched question (should score high) ──────────────────────────────
section("TEST A — Matched question (answer SHOULD fit)")

matched_q = {
    "id": 1,
    "text": (
        "You mentioned building SponsorWise and Code Archaeologist. "
        "If you had to design a scalable backend for a real-time data pipeline, "
        "what would your architecture look like?"
    ),
    "category": "technical_depth",
    "skill_tested": "system design, scalable architecture",
    "expected_answer_duration_seconds": 120,
    "is_intro": False,
}
score_and_print("Matched system design question", matched_q, expected_min_content=5)


# ── Test B: Off-topic question (should score low, possibly anomaly) ────────────
section("TEST B — Off-topic question (answer should NOT fit)")

offtopic_q = {
    "id": 2,
    "text": "Tell me about yourself — your background and what excites you about this role.",
    "category": "communication_clarity",
    "skill_tested": "self-introduction, communication",
    "expected_answer_duration_seconds": 120,
    "is_intro": True,
}
score_and_print("Intro/self-introduction question", offtopic_q, expected_min_content=1)


# ── Test C: Partially relevant question ───────────────────────────────────────
section("TEST C — Partially relevant question")

partial_q = {
    "id": 3,
    "text": (
        "Describe a situation where you had to optimize the performance "
        "of a system under high traffic. What steps did you take?"
    ),
    "category": "problem_solving",
    "skill_tested": "performance optimization, system thinking",
    "expected_answer_duration_seconds": 90,
    "is_intro": False,
}
score_and_print("Performance optimization question", partial_q, expected_min_content=4)


# ── Test D: Semantic similarity check ─────────────────────────────────────────
section("TEST D — Semantic similarity (sentence-transformers)")

try:
    from core.scoring_engine import compute_semantic_similarity

    pairs = [
        ("Design a scalable real-time data pipeline", TRANSCRIPT, "should be HIGH"),
        ("Tell me about yourself and your background", TRANSCRIPT, "should be LOW"),
        ("How would you optimize a backend under high traffic?", TRANSCRIPT, "should be MEDIUM"),
    ]

    for q_text, a_text, expectation in pairs:
        sim = compute_semantic_similarity(q_text, a_text)
        if sim == -1.0:
            print(f"  ⚠  sentence-transformers not installed — similarity unavailable")
            print(f"     Install with: pip install sentence-transformers")
            break
        print(f"  Similarity: {sim:.3f}  ({expectation})")
        print(f"  Q: \"{q_text[:60]}\"")

except ImportError:
    print("  ⚠  scoring_engine not importable")


# ── Summary ───────────────────────────────────────────────────────────────────
print(f"\n{'='*60}")
print("  TRANSCRIPT USED")
print(f"{'='*60}")
print(f"  {TRANSCRIPT}")
print(f"\n  WPM: {AUDIO_SIGNALS['words_per_minute']} | Duration: {AUDIO_SIGNALS['answer_duration_seconds']}s")
print(f"  Eye contact: {VIDEO_SIGNALS['eye_contact_percentage']}% | Posture: {VIDEO_SIGNALS['posture_score']}")
print()