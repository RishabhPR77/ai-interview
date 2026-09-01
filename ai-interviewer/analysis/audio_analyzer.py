import os
import re
import tempfile
import numpy as np
from typing import Optional


def _get_librosa():
    import librosa
    return librosa


FILLER_WORDS = {
    "um", "uh", "you know", "basically", "literally",
    "kind of", "sort of", "i mean", "you see", "hmm", "ah", "er",
}

HEDGING_PHRASES = [
    "i think", "i believe", "maybe", "perhaps", "possibly",
    "i'm not sure", "i guess", "it might", "could be", "probably",
    "i suppose", "not certain", "kind of", "sort of"
]

CONFIDENT_PHRASES = [
    "i built", "i designed", "i led", "i implemented", "i solved",
    "i created", "i managed", "i developed", "we achieved", "the result was",
    "specifically", "for example", "in that case", "the outcome"
]

TECH_CORRECTIONS = {
    "trok api": "Groq API",
    "trock api": "Groq API",
    "groc api": "Groq API",
    "lama": "LLaMA",
    "llama 3.3": "LLaMA-3.3-70B",
    "lama 3.3": "LLaMA-3.3-70B",
    "sponsor device": "SponsorWise",
    "sponsor wise": "SponsorWise",
    "sponsorwise": "SponsorWise",
    "code archeologist": "Code Archaeologist",
    "code archaeologist": "Code Archaeologist",
    "pine cone": "Pinecone",
    "pinecon": "Pinecone",
    "xgb": "XGBoost",
    "x g boost": "XGBoost",
    "x g b": "XGBoost",
    "refrector": "refactor",
    "refrect": "refactor",
    "mediapipe": "MediaPipe",
    "media pipe": "MediaPipe",
    "fast api": "FastAPI",
    "fast a p i": "FastAPI",
    "ai interwave": "AI interview",
    "interwave": "interview",
    "bge": "BGE",
    "b g e": "BGE",
    "r a g": "RAG",
    "socket dot io": "Socket.IO",
    "j w t": "JWT",
    "r b a c": "RBAC",
}


def correct_tech_terms(text: str) -> str:
    result = text
    lower = text.lower()
    for wrong, correct in TECH_CORRECTIONS.items():
        if wrong in lower:
            result = re.sub(re.escape(wrong), correct, result, flags=re.IGNORECASE)
            lower = result.lower()
    return result


def transcribe_audio(audio_path: str) -> dict:
    """
    Transcribe audio using Groq Whisper API (whisper-large-v3-turbo).
    Much faster than local Whisper and handles technical vocabulary better.
    Falls back to local Whisper base if Groq API fails.
    """
    try:
        from groq import Groq
        client = Groq(api_key=os.getenv("GROQ_API_KEY"))
        with open(audio_path, "rb") as f:
            transcription = client.audio.transcriptions.create(
                model="whisper-large-v3-turbo",
                file=f,
                response_format="verbose_json",
                language="en",
            )
        return {"text": transcription.text}
    except Exception as e:
        print(f"      [audio] Groq Whisper failed ({e}), falling back to local Whisper...")
        return _transcribe_local(audio_path)


_whisper_model = None


def _transcribe_local(audio_path: str) -> dict:
    """Fallback: local Whisper base model."""
    import whisper
    global _whisper_model
    if _whisper_model is None:
        _whisper_model = whisper.load_model(os.getenv("WHISPER_MODEL", "base"))
    result = _whisper_model.transcribe(audio_path, word_timestamps=True)
    return result


def compute_audio_signals(audio_path: str) -> dict:
    """
    Full audio analysis pipeline.
    Returns AudioSignals-compatible dict.
    """
    try:
        librosa = _get_librosa()

        y, sr = librosa.load(audio_path, sr=None)
        duration = librosa.get_duration(y=y, sr=sr)

        transcription = transcribe_audio(audio_path)
        transcript = correct_tech_terms(transcription.get("text", "").strip())
        words = transcript.split()
        word_count = len(words)

        # ── Detect silent/empty recordings ──────────────────────────────────
        # If there's no meaningful transcript (candidate didn't speak, or only
        # said a couple of stray words), flag it so the scoring layer can
        # short-circuit instead of asking the LLM to score nothing.
        is_silent = word_count < 3

        wpm = (word_count / duration * 60) if duration > 0 else 0

        pause_count = _count_pauses(y, sr)

        transcript_lower = transcript.lower()
        found_fillers = []
        filler_count = 0
        for filler in FILLER_WORDS:
            pattern = r'\b' + re.escape(filler) + r'\b'
            occurrences = len(re.findall(pattern, transcript_lower))
            if occurrences > 0:
                found_fillers.append(filler)
                filler_count += occurrences

        hedging_count = sum(
            len(re.findall(r'\b' + re.escape(phrase) + r'\b', transcript_lower))
            for phrase in HEDGING_PHRASES
        )

        confident_hits = sum(
            transcript_lower.count(phrase) for phrase in CONFIDENT_PHRASES
        )

        base = 6.0
        confident_boost = min(3.0, confident_hits * 1.2)
        hedging_penalty = min(3.0, hedging_count * 0.7)
        filler_penalty = min(1.5, filler_count * 0.1)
        confidence_language_score = round(
            max(1.0, min(10.0, base + confident_boost - hedging_penalty - filler_penalty)), 1
        )

        return {
            "transcript": transcript,
            "words_per_minute": round(wpm, 1),
            "pause_count": pause_count,
            "filler_word_count": filler_count,
            "filler_words_found": found_fillers,
            "answer_duration_seconds": round(duration, 1),
            "confidence_language_score": round(confidence_language_score, 1),
            "hedging_count": hedging_count,
            "word_count": word_count,
            "is_silent": is_silent,
        }

    except Exception as e:
        return _empty_audio_signals(error=str(e))


def _count_pauses(y: np.ndarray, sr: int, min_pause_seconds: float = 1.0) -> int:
    """
    Count pauses longer than min_pause_seconds.
    Uses peak-relative threshold instead of percentile so continuous
    speech doesn't generate false pauses.
    """
    try:
        librosa = _get_librosa()
        frame_length = int(sr * 0.05)
        hop_length = frame_length // 2
        rms = librosa.feature.rms(y=y, frame_length=frame_length, hop_length=hop_length)[0]

        # Peak-relative threshold: anything below 5% of peak amplitude = silence.
        # This avoids classifying quiet-but-present speech as silence.
        peak = np.max(rms)
        if peak < 1e-6:
            return 0
        silence_threshold = peak * 0.05

        is_silent = rms < silence_threshold
        min_pause_frames = int(min_pause_seconds / (hop_length / sr))
        pause_count = 0
        consecutive = 0
        for s in is_silent:
            if s:
                consecutive += 1
            else:
                if consecutive >= min_pause_frames:
                    pause_count += 1
                consecutive = 0
        return pause_count
    except Exception:
        return 0


def _empty_audio_signals(error: str = "") -> dict:
    return {
        "transcript": f"[transcription unavailable: {error}]",
        "words_per_minute": 0.0,
        "pause_count": 0,
        "filler_word_count": 0,
        "filler_words_found": [],
        "answer_duration_seconds": 0.0,
        "confidence_language_score": 0.0,
        "hedging_count": 0,
        "word_count": 0,
        "is_silent": True,
    }