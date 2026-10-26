# Single-service image: FastAPI serves the API at /api/v1 and the built React
# app at /, so the session cookie stays same-origin (no CORS, SameSite=Lax).
#
#   docker build -t tejaskrit .
#   docker run -p 8000:8000 --env-file ai-interviewer/.env -v tk-data:/data tejaskrit

# ── 1. Build the frontend ───────────────────────────────────────────────────
FROM node:22-alpine AS web
WORKDIR /web
COPY ai-interview-ui/package.json ai-interview-ui/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY ai-interview-ui/ ./
RUN npm run build

# ── 2. Python runtime ───────────────────────────────────────────────────────
FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    ENV=production \
    DATA_DIR=/data \
    STATIC_DIR=/app/web

# ffmpeg: video compression + audio extraction. libgl/glib: OpenCV.
# libgles2/libegl1: MediaPipe Tasks (FaceLandmarker) loads GLES even on CPU.
RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg libgl1 libglib2.0-0 libgles2 libegl1 curl \
 && rm -rf /var/lib/apt/lists/*

RUN useradd --create-home --uid 10001 app \
 && mkdir -p /data /home/app/.cache/mediapipe \
 && chown -R app:app /data /home/app/.cache

WORKDIR /app/api
COPY ai-interviewer/requirements.txt .
RUN pip install -r requirements.txt

# Bake the MediaPipe face + pose models in so the first interview doesn't download them.
RUN curl -fsSL -o /home/app/.cache/mediapipe/face_landmarker.task \
      https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task \
 && curl -fsSL -o /home/app/.cache/mediapipe/pose_landmarker_lite.task \
      https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task \
 && chown -R app:app /home/app/.cache/mediapipe

COPY ai-interviewer/ ./
COPY --from=web /web/dist /app/web

USER app
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s CMD curl -fs http://127.0.0.1:${PORT:-8000}/health || exit 1

# One worker: answer processing is CPU-heavy (MediaPipe) and the in-process
# OTP/IP rate limiter is per-process. Scale with more instances + Postgres.
CMD ["sh", "-c", "exec uvicorn main:app --host 0.0.0.0 --port ${PORT:-8000} --proxy-headers --forwarded-allow-ips='*' --timeout-keep-alive 75"]
