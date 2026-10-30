"""
Central configuration, read once from the environment.

Every secret has a safe development default so `uvicorn main:app` works out of
the box, but ENV=production refuses to start without the real values.
"""
import base64
import hashlib
import os
import secrets
from pathlib import Path

from dotenv import load_dotenv

load_dotenv()

BASE_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = Path(os.getenv("DATA_DIR", BASE_DIR / "data"))
DATA_DIR.mkdir(parents=True, exist_ok=True)

ENV = os.getenv("ENV", "development").lower()
IS_PROD = ENV == "production"

APP_NAME = os.getenv("APP_NAME", "tejaskrit")
# Public URL of the web app — used in emails and for the cookie's Secure flag.
APP_URL = os.getenv("APP_URL", "http://localhost:5173").rstrip("/")

DATABASE_URL = os.getenv("DATABASE_URL", f"sqlite:///{(DATA_DIR / 'app.db').as_posix()}")
# Render / Heroku style URLs use the legacy scheme; SQLAlchemy needs a driver.
if DATABASE_URL.startswith("postgres://"):
    DATABASE_URL = "postgresql+psycopg://" + DATABASE_URL[len("postgres://"):]
elif DATABASE_URL.startswith("postgresql://"):
    DATABASE_URL = "postgresql+psycopg://" + DATABASE_URL[len("postgresql://"):]


def _dev_secret(name: str) -> str:
    """Persist a random secret under DATA_DIR so dev restarts keep sessions/keys valid."""
    path = DATA_DIR / f".dev_{name.lower()}"
    if path.exists():
        return path.read_text().strip()
    value = secrets.token_urlsafe(48)
    path.write_text(value)
    return value


def _required(name: str) -> str:
    value = os.getenv(name, "").strip()
    if value:
        return value
    if IS_PROD:
        raise RuntimeError(f"{name} must be set when ENV=production")
    return _dev_secret(name)


# Signs OTP hashes. Rotating it invalidates outstanding OTP codes only.
SECRET_KEY = _required("SECRET_KEY")

# Encrypts users' provider API keys at rest. Rotating it makes stored keys
# unreadable (users would need to re-enter them) — back it up.
_raw_enc = _required("ENCRYPTION_KEY")
try:
    if len(base64.urlsafe_b64decode(_raw_enc.encode())) != 32:
        raise ValueError
    ENCRYPTION_KEY = _raw_enc.encode()
except Exception:
    # Accept any passphrase and derive a valid 32-byte Fernet key from it.
    ENCRYPTION_KEY = base64.urlsafe_b64encode(hashlib.sha256(_raw_enc.encode()).digest())

# ── Email (Brevo) ───────────────────────────────────────────────────────────
BREVO_API_KEY = os.getenv("BREVO_API_KEY", "").strip()
EMAIL_FROM_ADDRESS = os.getenv("EMAIL_FROM_ADDRESS", "").strip()
EMAIL_FROM_NAME = os.getenv("EMAIL_FROM_NAME", APP_NAME).strip()
if IS_PROD and not (BREVO_API_KEY and EMAIL_FROM_ADDRESS):
    raise RuntimeError("BREVO_API_KEY and EMAIL_FROM_ADDRESS must be set when ENV=production")

# ── Auth ────────────────────────────────────────────────────────────────────
OTP_TTL_MINUTES = int(os.getenv("OTP_TTL_MINUTES", "10"))
OTP_MAX_ATTEMPTS = int(os.getenv("OTP_MAX_ATTEMPTS", "5"))
OTP_RESEND_COOLDOWN_SECONDS = int(os.getenv("OTP_RESEND_COOLDOWN_SECONDS", "60"))
OTP_MAX_PER_HOUR = int(os.getenv("OTP_MAX_PER_HOUR", "5"))
SESSION_TTL_DAYS = int(os.getenv("SESSION_TTL_DAYS", "30"))
SESSION_COOKIE_NAME = "tk_session"
# "lax" works when the API and web app share a site (recommended: one service).
# Use "none" only if the frontend is hosted on a different site — it requires HTTPS.
COOKIE_SAMESITE = os.getenv("COOKIE_SAMESITE", "lax").lower()
COOKIE_SECURE = os.getenv("COOKIE_SECURE", "true" if APP_URL.startswith("https") else "false").lower() == "true"

# Comma-separated origins allowed to call the API with credentials. Only needed
# when the frontend is served from a different origin than the API.
CORS_ORIGINS = [o.strip() for o in os.getenv(
    "CORS_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173"
).split(",") if o.strip()]

# Cloudflare Turnstile on the sign-in form. Leave both unset to disable (dev).
TURNSTILE_SITE_KEY = os.getenv("TURNSTILE_SITE_KEY", "").strip()
TURNSTILE_SECRET_KEY = os.getenv("TURNSTILE_SECRET_KEY", "").strip()
if bool(TURNSTILE_SITE_KEY) != bool(TURNSTILE_SECRET_KEY):
    raise RuntimeError("Set both TURNSTILE_SITE_KEY and TURNSTILE_SECRET_KEY, or neither")

# ── Usage limits (protect the server's CPU; AI calls are billed to users' keys) ──
MAX_INTERVIEWS_PER_DAY = int(os.getenv("MAX_INTERVIEWS_PER_DAY", "10"))
# Longest answer recording analysed. The web app stops recording at 3 minutes.
MAX_ANSWER_SECONDS = int(os.getenv("MAX_ANSWER_SECONDS", "240"))
# Finished reports stay retrievable this long, then are deleted.
REPORT_RETENTION_HOURS = int(os.getenv("REPORT_RETENTION_HOURS", "24"))

# ── Uploads / serving ───────────────────────────────────────────────────────
MAX_UPLOAD_MB = int(os.getenv("MAX_UPLOAD_MB", "100"))
# Answers are analysed in background threads; each video analysis is CPU-heavy.
ANALYSIS_WORKERS = int(os.getenv("ANALYSIS_WORKERS", "2"))
# A job still "processing" after this long is failed so the candidate can re-submit.
# It covers only the quick step (transcribe + choose the next question).
ANSWER_JOB_TIMEOUT_SECONDS = int(os.getenv("ANSWER_JOB_TIMEOUT_SECONDS", "180"))
# Recordings wait here for background video analysis, then are deleted.
RECORDINGS_DIR = DATA_DIR / "recordings"
RECORDINGS_DIR.mkdir(parents=True, exist_ok=True)
# Built frontend (vite build output). Served by FastAPI when present.
STATIC_DIR = Path(os.getenv("STATIC_DIR", BASE_DIR.parent / "ai-interview-ui" / "dist"))
# Opt-in local Whisper fallback (needs `pip install openai-whisper`, ~2GB with torch).
LOCAL_WHISPER_FALLBACK = os.getenv("LOCAL_WHISPER_FALLBACK", "false").lower() == "true"
