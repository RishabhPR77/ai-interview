import logging
import shutil
import sys
import threading
import time
from contextlib import asynccontextmanager

# Progress logs print non-ASCII ("→", "—"). On Windows, redirected stdout is
# cp1252 and would raise mid-analysis, failing the candidate's answer.
for _stream in (sys.stdout, sys.stderr):
    if hasattr(_stream, "reconfigure"):
        _stream.reconfigure(encoding="utf-8", errors="replace")

from core import config  # loads .env and validates production secrets first

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse

from analysis import audio_analyzer
from core import session_store
from core.db import init_db
from core.llm import AIError
from routes.account import router as account_router
from routes.auth import router as auth_router
from routes import interview
from routes.interview import router as interview_router

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger("tejaskrit")


@asynccontextmanager
async def lifespan(_: FastAPI):
    init_db()
    purged = session_store.purge_stale()
    if purged:
        log.info("Purged %d abandoned interview sessions", purged)
    if not shutil.which("ffmpeg"):
        log.warning("ffmpeg not found on PATH — video compression and audio extraction will fail")
    interview.resume_background_work()
    threading.Thread(target=audio_analyzer.warm_up, daemon=True).start()
    log.info("Started in %s mode", config.ENV)
    yield


app = FastAPI(
    title="AI Interviewer",
    description="Advanced AI-powered interview system with video, audio, gesture and expression analysis",
    version="2.0.0",
    lifespan=lifespan,
    docs_url=None if config.IS_PROD else "/docs",
    redoc_url=None,
    openapi_url=None if config.IS_PROD else "/openapi.json",
)

# Only needed when the web app is served from another origin (e.g. vite dev
# server without its proxy). Same-origin deployments don't use CORS at all.
app.add_middleware(
    CORSMiddleware,
    allow_origins=config.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE"],
    allow_headers=["Content-Type", "X-Requested-With"],
)

_UNSAFE_METHODS = {"POST", "PUT", "PATCH", "DELETE"}


@app.middleware("http")
async def security_middleware(request: Request, call_next):
    request.state.started_at = time.monotonic()
    # CSRF defence in depth (the session cookie is already SameSite): browsers
    # only let pages send this custom header cross-origin after a CORS
    # preflight, which only CORS_ORIGINS pass.
    if (request.method in _UNSAFE_METHODS and request.url.path.startswith("/api/")
            and request.headers.get("x-requested-with") != "tejaskrit"):
        return JSONResponse({"detail": "Missing X-Requested-With header"}, status_code=403)

    response = await call_next(request)
    response.headers.setdefault("X-Content-Type-Options", "nosniff")
    response.headers.setdefault("X-Frame-Options", "DENY")
    response.headers.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
    response.headers.setdefault("Permissions-Policy", "camera=(self), microphone=(self), geolocation=()")
    if config.COOKIE_SECURE:
        response.headers.setdefault("Strict-Transport-Security", "max-age=31536000; includeSubDomains")
    if request.url.path.startswith("/api/"):
        response.headers.setdefault("Cache-Control", "no-store")
    return response


@app.exception_handler(AIError)
async def ai_error_handler(_: Request, exc: AIError):
    return JSONResponse({"detail": exc.message, "code": "ai_error"}, status_code=exc.status_code)


app.include_router(auth_router, prefix="/api/v1")
app.include_router(account_router, prefix="/api/v1")
app.include_router(interview_router, prefix="/api/v1", tags=["Interview"])


@app.get("/health")
def health():
    return {"status": "ok", "ffmpeg": bool(shutil.which("ffmpeg"))}


# ── Built frontend (single-service deployment) ──────────────────────────────
_static_root = config.STATIC_DIR.resolve()
_index = _static_root / "index.html"


@app.get("/{full_path:path}", include_in_schema=False)
def spa(full_path: str):
    if full_path.startswith("api/"):
        return JSONResponse({"detail": "Not found"}, status_code=404)
    if not _index.exists():
        return JSONResponse({
            "status": "running",
            "message": "API is up. Build the frontend (npm run build) to serve the web app from here.",
        })
    candidate = (_static_root / full_path).resolve()
    if full_path and candidate.is_file() and candidate.is_relative_to(_static_root):
        # Vite fingerprints everything under /assets, so it can be cached forever.
        cache = "public, max-age=31536000, immutable" if full_path.startswith("assets/") else "public, max-age=3600"
        return FileResponse(candidate, headers={"Cache-Control": cache})
    return FileResponse(_index, headers={"Cache-Control": "no-cache"})
