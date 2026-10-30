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

# Common speech-to-text mishearings of technical terms. Matched as whole words
# / phrases only (case-insensitive), so ordinary speech is never rewritten —
# e.g. "for a great team" must not become "foRAGreat team".
TECH_CORRECTIONS = {
    "trok api": "Groq API",
    "trock api": "Groq API",
    "groc api": "Groq API",
    "pine cone": "Pinecone",
    "pinecon": "Pinecone",
    "x g boost": "XGBoost",
    "media pipe": "MediaPipe",
    "fast api": "FastAPI",
    "fast a p i": "FastAPI",
    "socket dot io": "Socket.IO",
    "next js": "Next.js",
    "node js": "Node.js",
    "post gres": "Postgres",
    "postgre sql": "PostgreSQL",
    "kubernetis": "Kubernetes",
    "cooper netties": "Kubernetes",
    "j w t": "JWT",
    "r b a c": "RBAC",
}

_CORRECTION_PATTERNS = [
    (re.compile(r"(?<![\w-])" + re.escape(wrong) + r"(?![\w-])", re.IGNORECASE), right)
    for wrong, right in TECH_CORRECTIONS.items()
]


def correct_tech_terms(text: str) -> str:
    for pattern, right in _CORRECTION_PATTERNS:
        text = pattern.sub(right, text)
    return text


def transcribe_audio(audio_path: str) -> dict:
    """
    Transcribe audio with the user's chosen speech-to-text model
    (Groq / OpenAI Whisper-family, or a multimodal Gemini / OpenRouter model).
    Key/model problems are raised so the user sees them; transient failures
    fall back to local Whisper only when LOCAL_WHISPER_FALLBACK=true.
    """
    from core import llm
    from core.config import LOCAL_WHISPER_FALLBACK

    target = llm.current_config().stt
    try:
        return {"text": llm.transcribe(target, audio_path)}
    except llm.AIError as e:
        if not (e.retryable and LOCAL_WHISPER_FALLBACK):
            raise
        print(f"      [audio] {target.label} transcription failed ({e.message}), falling back to local Whisper...")
        return _transcribe_local(audio_path)


_whisper_model = None


def _transcribe_local(audio_path: str) -> dict:
    """Optional fallback: local Whisper (pip install openai-whisper)."""
    import whisper
    global _whisper_model
    if _whisper_model is None:
        _whisper_model = whisper.load_model(os.getenv("WHISPER_MODEL", "base"))
    result = _whisper_model.transcribe(audio_path, word_timestamps=True)
    return result


def warm_up() -> None:
    """librosa's first use takes ~25s on a small server (lazy imports, JIT).
    Pay that at startup, not while a candidate waits for their next question."""
    import soundfile
    y = np.zeros(16000, dtype=np.float32)
    with tempfile.TemporaryDirectory() as tmp:
        path = os.path.join(tmp, "warmup.wav")
        soundfile.write(path, y, 16000)
        y, sr = _get_librosa().load(path, sr=None)
        _speech_seconds(y, sr)
        _count_pauses(y, sr)


# Loudness floor for speech (RMS ~0.008 ≈ -42 dBFS). An open mic with nobody
# talking sits well below it; normal speech is roughly -30 to -12 dBFS.
SPEECH_RMS_THRESHOLD = 0.008
MIN_SPEECH_SECONDS = 1.5

# Whisper-family models tend to invent these on silent or near-silent audio.
_SILENCE_HALLUCINATIONS = {
    "you", "bye", "bye bye", "thank you", "thank you very much", "thanks",
    "thanks for watching", "thank you for watching", "thank you so much for watching",
    "please subscribe", "subtitles by the amaraorg community", "so", "okay",
}


def _speech_seconds(y: np.ndarray, sr: int) -> float:
    """Seconds of audio loud enough to plausibly be speech."""
    librosa = _get_librosa()
    frame_length = int(sr * 0.05)
    hop_length = frame_length // 2
    rms = librosa.feature.rms(y=y, frame_length=frame_length, hop_length=hop_length)[0]
    return float((rms > SPEECH_RMS_THRESHOLD).sum() * hop_length / sr)


def _is_silence_hallucination(transcript: str) -> bool:
    normalized = " ".join(re.sub(r"[^a-z ]", "", transcript.lower()).split())
    return normalized in _SILENCE_HALLUCINATIONS


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
        # If the candidate didn't really speak, flag it so the scoring layer
        # short-circuits instead of asking the LLM to score nothing. Whisper
        # often "hears" a stock phrase in silence, so the transcript alone isn't
        # enough: also require audible speech behind any short transcript.
        speech_seconds = _speech_seconds(y, sr)
        is_silent = (
            word_count < 3
            or _is_silence_hallucination(transcript)
            or (speech_seconds < MIN_SPEECH_SECONDS and word_count < 8)
        )
        if is_silent and word_count:
            print(f"      [audio] Treating as silent: {speech_seconds:.1f}s of speech, transcript {transcript!r}")

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
            len(re.findall(r'\b' + re.escape(phrase) + r'\b', transcript_lower))
            for phrase in CONFIDENT_PHRASES
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
            "speech_seconds": round(speech_seconds, 1),
            "is_silent": is_silent,
        }

    except Exception as e:
        from core.llm import AIError
        from analysis.errors import AnalysisError
        if isinstance(e, (AIError, AnalysisError)):
            raise
        # A decoding/analysis failure is not the same as the candidate saying
        # nothing — never score it as a silent answer.
        print(f"      [audio] analysis failed: {e}")
        raise AnalysisError("We couldn't read the audio in your recording. Please submit it again.") from e


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
