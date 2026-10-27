"""
Provider-agnostic LLM + speech-to-text calls using each user's own API keys.

Anthropic goes through the official `anthropic` SDK. OpenAI, Groq, Gemini and
OpenRouter all expose OpenAI-compatible endpoints, so they share the `openai`
SDK with a per-provider base URL and a few provider-specific parameters.

Model IDs below are only *suggestions* shown in Settings (checked against each
provider's docs, Oct 2026). Users can pick anything their key can access — the
live list comes from `list_models()`.
"""
import base64
import contextvars
import json
import re
import time
from contextlib import contextmanager
from dataclasses import dataclass
from typing import Iterator, Optional

import anthropic
import httpx
import openai

from core.config import APP_NAME, APP_URL

PROVIDERS: dict[str, dict] = {
    "anthropic": {
        "label": "Anthropic",
        "key_url": "https://platform.claude.com/settings/keys",
        "key_prefix": "sk-ant-",
        "llm": ["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5"],
        "fast_default": "claude-haiku-5-5",
        "stt": [],
    },
    "openai": {
        "label": "OpenAI",
        "key_url": "https://platform.openai.com/api-keys",
        "key_prefix": "sk-",
        "base_url": None,
        "llm": ["gpt-6.1-sol", "gpt-6-astra", "gpt-6-luna"],
        "fast_default": "gpt-6-luna",
        "stt": ["gpt-transcribe", "whisper-1"],
    },
    "groq": {
        "label": "Groq",
        "key_url": "https://console.groq.com/keys",
        "key_prefix": "gsk_",
        "base_url": "https://api.groq.com/openai/v1",
        "llm": ["openai/gpt-oss-120b", "openai/gpt-oss-20b", "qwen/qwen3.8-27b"],
        "fast_default": "openai/gpt-oss-20b",
        "stt": ["whisper-large-v3-turbo", "whisper-large-v3"],
    },
    "gemini": {
        "label": "Google Gemini",
        "key_url": "https://aistudio.google.com/apikey",
        "key_prefix": "",
        "base_url": "https://generativelanguage.googleapis.com/v1beta/openai/",
        "llm": ["gemini-3.8-flash", "gemini-4-argon", "gemini-3.5-flash-lite"],
        "fast_default": "gemini-3.5-flash-lite",
        # No transcription endpoint — audio is sent to a multimodal chat model.
        "stt": ["gemini-3.8-flash", "gemini-3.5-flash-lite"],
    },
    "openrouter": {
        "label": "OpenRouter",
        "key_url": "https://openrouter.ai/settings/keys",
        "key_prefix": "sk-or-",
        "base_url": "https://openrouter.ai/api/v1",
        "llm": ["openrouter/auto"],
        "fast_default": "openrouter/auto",
        # Any audio-input chat model works; the live list filters for them.
        "stt": [],
    },
}

STT_PROVIDERS = {"openai", "groq", "gemini", "openrouter"}
# Claude models that accept server-side refusal fallbacks ("default" routing).
_ANTHROPIC_FALLBACK_MODELS = {"claude-fable-5-1", "claude-opus-5-5", "claude-opus-5", "claude-sonnet-5-5"}

SYSTEM_PROMPT = (
    "You are an expert AI interviewer. Always respond with valid JSON only. "
    "No extra text, no markdown, no code fences."
)


class AIError(Exception):
    """A provider problem the user can act on (bad key, unknown model, quota)."""

    def __init__(self, message: str, status_code: int = 400, retryable: bool = False):
        super().__init__(message)
        self.message = message
        self.status_code = status_code
        self.retryable = retryable


@dataclass(frozen=True)
class Target:
    provider: str
    model: str
    api_key: str

    @property
    def label(self) -> str:
        return PROVIDERS[self.provider]["label"]


@dataclass(frozen=True)
class AIConfig:
    eval: Target   # question generation, scoring, final report
    fast: Target   # routing decisions, follow-ups, seniority detection
    stt: Target    # speech-to-text


_current: contextvars.ContextVar[Optional[AIConfig]] = contextvars.ContextVar("ai_config", default=None)


@contextmanager
def use_config(config: AIConfig) -> Iterator[None]:
    token = _current.set(config)
    try:
        yield
    finally:
        _current.reset(token)


def current_config() -> AIConfig:
    config = _current.get()
    if config is None:
        raise AIError("AI providers are not configured for this request.", status_code=500)
    return config


# ── Error translation ───────────────────────────────────────────────────────

def _translate(e: Exception, target: Target) -> AIError:
    who = f"{target.label} ({target.model})"
    status = getattr(e, "status_code", None)
    detail = ""
    body = getattr(e, "body", None)
    if isinstance(body, dict):
        err = body.get("error", body)
        detail = (err.get("message") if isinstance(err, dict) else str(err)) or ""
    detail = (detail or str(e))[:300]

    if isinstance(e, (anthropic.AuthenticationError, openai.AuthenticationError)) or status == 401:
        return AIError(f"Your {target.label} API key was rejected. Update it in Settings.", 400)
    if isinstance(e, (anthropic.PermissionDeniedError, openai.PermissionDeniedError)) or status == 403:
        return AIError(f"Your {target.label} key doesn't have access to {target.model}: {detail}", 400)
    if isinstance(e, (anthropic.NotFoundError, openai.NotFoundError)) or status == 404:
        return AIError(f"{who}: model not found. Pick another model in Settings.", 400)
    if isinstance(e, (anthropic.RateLimitError, openai.RateLimitError)) or status == 429:
        return AIError(f"{who} rate limit or quota reached: {detail}", 429, retryable=True)
    if isinstance(e, (anthropic.BadRequestError, openai.BadRequestError)) or status in (400, 422):
        if "api key" in detail.lower() or "api_key" in detail.lower():
            return AIError(f"Your {target.label} API key was rejected. Update it in Settings.", 400)
        return AIError(f"{who} rejected the request: {detail}", 400)
    if isinstance(e, (anthropic.APIConnectionError, openai.APIConnectionError, httpx.HTTPError)):
        return AIError(f"Couldn't reach {target.label}. Please try again.", 502, retryable=True)
    return AIError(f"{who} error: {detail}", 502, retryable=True)


# ── Clients ─────────────────────────────────────────────────────────────────

def _openai_client(target: Target) -> openai.OpenAI:
    cfg = PROVIDERS[target.provider]
    headers = {}
    if target.provider == "openrouter":
        headers = {"HTTP-Referer": APP_URL, "X-Title": APP_NAME}
    return openai.OpenAI(
        api_key=target.api_key,
        base_url=cfg.get("base_url"),
        default_headers=headers or None,
        timeout=180,
        max_retries=1,
    )


def _anthropic_client(api_key: str) -> anthropic.Anthropic:
    return anthropic.Anthropic(api_key=api_key, timeout=300, max_retries=2)


# ── Chat (JSON) ─────────────────────────────────────────────────────────────

def _chat_anthropic(target: Target, prompt: str, max_tokens: int) -> tuple[str, bool]:
    client = _anthropic_client(target.api_key)
    # Current Claude models think adaptively and thinking tokens count toward
    # max_tokens, so leave generous headroom and stream to avoid HTTP timeouts.
    params = dict(
        model=target.model,
        max_tokens=min(max(16000, max_tokens * 4), 64000),
        system=SYSTEM_PROMPT,
        messages=[{"role": "user", "content": prompt}],
    )
    if target.model in _ANTHROPIC_FALLBACK_MODELS:
        stream = client.beta.messages.stream(
            **params, betas=["server-side-fallback-2026-07-01"], fallbacks="default",
        )
    else:
        stream = client.messages.stream(**params)
    with stream as s:
        message = s.get_final_message()
    if message.stop_reason == "refusal":
        raise AIError(f"{target.label} ({target.model}) declined to answer this request.", 422)
    text = "".join(block.text for block in message.content if block.type == "text")
    return text, message.stop_reason == "max_tokens"


def _chat_openai_compatible(target: Target, prompt: str, max_tokens: int) -> tuple[str, bool]:
    client = _openai_client(target)
    kwargs: dict = {
        "model": target.model,
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": prompt},
        ],
    }
    if target.provider == "openai":
        # Reasoning models take max_completion_tokens and reject custom temperature.
        kwargs["max_completion_tokens"] = max_tokens
    elif target.provider == "gemini":
        kwargs["max_tokens"] = max_tokens
        kwargs["reasoning_effort"] = "low"
    else:
        kwargs["max_tokens"] = max_tokens
        kwargs["temperature"] = 0.4
        if target.provider == "groq" and target.model.startswith("openai/gpt-oss"):
            kwargs["reasoning_effort"] = "low"
            kwargs["extra_body"] = {"include_reasoning": False}

    response = client.chat.completions.create(**kwargs)
    choice = response.choices[0]
    return (choice.message.content or ""), choice.finish_reason == "length"


def chat(target: Target, prompt: str, max_tokens: int) -> tuple[str, bool]:
    """One completion. Returns (text, truncated). Raises AIError."""
    try:
        if target.provider == "anthropic":
            return _chat_anthropic(target, prompt, max_tokens)
        return _chat_openai_compatible(target, prompt, max_tokens)
    except AIError:
        raise
    except Exception as e:
        raise _translate(e, target) from e


def parse_json(raw: str) -> dict:
    """Parse a JSON object from model output, tolerating fences or stray prose."""
    raw = (raw or "").strip()
    if raw.startswith("```"):
        raw = re.sub(r"^```(?:json)?\s*|\s*```$", "", raw, flags=re.IGNORECASE).strip()
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        start, end = raw.find("{"), raw.rfind("}")
        if start != -1 and end > start:
            return json.loads(raw[start:end + 1])
        raise


# ── Speech-to-text ──────────────────────────────────────────────────────────

_TRANSCRIBE_PROMPT = (
    "Transcribe this interview answer verbatim in English. Keep filler words "
    "(um, uh, like) and false starts. Return only the transcript text — no "
    "labels, timestamps, quotes or commentary. If there is no speech, return an empty string."
)


def transcribe(target: Target, audio_path: str) -> str:
    """Transcribe a WAV file with the user's chosen speech-to-text model."""
    try:
        client = _openai_client(target)
        if target.provider in ("openai", "groq"):
            kwargs: dict = {"model": target.model}
            if target.provider == "groq" or target.model.startswith("whisper"):
                kwargs["language"] = "en"
            with open(audio_path, "rb") as f:
                result = client.audio.transcriptions.create(file=f, **kwargs)
            return (getattr(result, "text", None) or str(result)).strip()

        # Gemini / OpenRouter: send audio to a multimodal chat model.
        with open(audio_path, "rb") as f:
            audio_b64 = base64.b64encode(f.read()).decode()
        response = client.chat.completions.create(
            model=target.model,
            messages=[{
                "role": "user",
                "content": [
                    {"type": "text", "text": _TRANSCRIBE_PROMPT},
                    {"type": "input_audio", "input_audio": {"data": audio_b64, "format": "wav"}},
                ],
            }],
        )
        return (response.choices[0].message.content or "").strip().strip('"')
    except AIError:
        raise
    except Exception as e:
        raise _translate(e, target) from e


# ── Key validation + model discovery ────────────────────────────────────────

_NON_CHAT = re.compile(
    r"embed|tts|dall-e|image|imagen|veo|moderation|search|realtime|live|audio|"
    r"transcribe|whisper|guard|aqa|computer-use|codex-mini|babbage|davinci|sora",
    re.IGNORECASE,
)
_model_cache: dict[tuple, tuple[float, dict]] = {}
_MODEL_CACHE_TTL = 600


def _model(mid: str, name: Optional[str] = None, detail: str = "") -> dict:
    """One entry in the Settings model dropdown."""
    return {"id": mid, "name": name or mid, "detail": detail}


def _context(tokens) -> str:
    if not tokens:
        return ""
    return f"{tokens / 1_000_000:g}M context" if tokens >= 1_000_000 else f"{round(tokens / 1000)}K context"


def list_models(provider: str, api_key: str) -> dict:
    """Return {"llm": [model...], "stt": [model...]} for this key, each model
    {"id", "name", "detail"}. Raises AIError on a bad key."""
    cache_key = (provider, api_key[-12:], hash(api_key))
    hit = _model_cache.get(cache_key)
    if hit and time.monotonic() - hit[0] < _MODEL_CACHE_TTL:
        return hit[1]

    target = Target(provider, "-", api_key)
    try:
        if provider == "anthropic":
            result = _list_anthropic(api_key)
        elif provider == "openrouter":
            result = _list_openrouter(api_key)
        elif provider == "gemini":
            result = _list_gemini(api_key)
        else:
            models = list(_openai_client(target).models.list())
            if provider == "openai":
                # The list has only ids and creation times; newest first.
                ids = [m.id for m in sorted(models, key=lambda m: m.created or 0, reverse=True)]
                stt = [_model(i) for i in ids if ("transcribe" in i or i.startswith("whisper"))
                       and "realtime" not in i and "diarize" not in i]
                llm = [_model(i) for i in ids if re.match(r"^(gpt-|o\d|chatgpt)", i) and not _NON_CHAT.search(i)]
            else:  # groq — models carry `active` and `context_window`
                live = sorted((m for m in models if getattr(m, "active", True) is not False), key=lambda m: m.id)
                stt = [_model(m.id) for m in live if "whisper" in m.id]
                llm = [_model(m.id, detail=_context(getattr(m, "context_window", None))) for m in live
                       if not _NON_CHAT.search(m.id) and "orpheus" not in m.id and "playai" not in m.id]
            result = {"llm": llm, "stt": stt}
    except AIError:
        raise
    except Exception as e:
        raise _translate(e, target) from e

    _model_cache[cache_key] = (time.monotonic(), result)
    return result


def _list_anthropic(api_key: str) -> dict:
    # The default listing holds active + deprecated models (retired ones are excluded).
    llm = []
    for m in _anthropic_client(api_key).models.list(limit=1000):
        lifecycle = getattr(m, "lifecycle", None)
        detail = "deprecated" if lifecycle == "deprecated" else _context(getattr(m, "max_input_tokens", None))
        llm.append(_model(m.id, getattr(m, "display_name", None), detail))
    return {"llm": llm, "stt": []}


def _list_gemini(api_key: str) -> dict:
    # The native endpoint (unlike the OpenAI-compatible one) gives display names
    # and which methods each model supports. Header auth keeps the key out of URLs/logs.
    resp = httpx.get(
        "https://generativelanguage.googleapis.com/v1beta/models",
        params={"pageSize": 1000}, headers={"x-goog-api-key": api_key}, timeout=30,
    )
    if resp.status_code >= 400:
        message = (resp.json().get("error") or {}).get("message", "") if resp.content else ""
        if resp.status_code in (400, 401, 403) and "key" in message.lower():
            raise AIError("Your Google Gemini API key was rejected.", 400)
        raise AIError(f"Google Gemini couldn't list models: {message or resp.status_code}", 502, retryable=True)
    llm = []
    for m in resp.json().get("models", []):
        mid = m.get("name", "").removeprefix("models/")
        if (mid.startswith("gemini") and "generateContent" in (m.get("supportedGenerationMethods") or [])
                and not _NON_CHAT.search(mid)):
            llm.append(_model(mid, m.get("displayName"), _context(m.get("inputTokenLimit"))))
    # Gemini chat models accept audio, so any of them can transcribe.
    return {"llm": llm, "stt": list(llm)}


def _list_openrouter(api_key: str) -> dict:
    headers = {"Authorization": f"Bearer {api_key}"}
    # /models is public, so check the key itself first.
    check = httpx.get("https://openrouter.ai/api/v1/key", headers=headers, timeout=20)
    if check.status_code in (401, 403):
        raise AIError("Your OpenRouter API key was rejected.", 400)
    resp = httpx.get("https://openrouter.ai/api/v1/models", headers=headers, timeout=30)
    resp.raise_for_status()
    llm, stt = [], []
    for m in resp.json().get("data", []):
        arch = m.get("architecture") or {}
        if "text" not in (arch.get("output_modalities") or ["text"]):
            continue
        entry = _model(m.get("id", ""), m.get("name"), _openrouter_price(m.get("pricing") or {}))
        llm.append(entry)
        if "audio" in (arch.get("input_modalities") or []):
            stt.append(entry)
    llm.sort(key=lambda e: e["name"].lower())
    stt.sort(key=lambda e: e["name"].lower())
    return {"llm": llm, "stt": stt}


def _openrouter_price(pricing: dict) -> str:
    """OpenRouter prices are USD per token; show them per 1M tokens."""
    try:
        prompt, completion = float(pricing.get("prompt", 0)), float(pricing.get("completion", 0))
    except (TypeError, ValueError):
        return ""
    if prompt < 0 or completion < 0:  # e.g. openrouter/auto: priced by the model it routes to
        return "price varies"
    if prompt == 0 and completion == 0:
        return "free"
    return f"${prompt * 1e6:.2f} in · ${completion * 1e6:.2f} out per 1M"


def validate_key(provider: str, api_key: str) -> None:
    list_models(provider, api_key)
