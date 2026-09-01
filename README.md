# AI Interviewer

An end-to-end AI interview practice platform. The candidate pastes a **job description**, uploads a **resume**, and is interviewed on video by an AI that generates **adaptive, role-tailored questions** — then receives a detailed performance report.

The system analyzes the answer from three angles in real time:

- **Content** — what the candidate said (transcript, relevance, depth, examples)
- **Audio behavior** — pace (WPM), filler words, hedging, pauses, confidence of language
- **Video behavior** — eye contact, posture, gesturing, facial expressions, drowsiness, nervousness indicators

Every answer is scored against a weighted rubric, the next question is chosen adaptively based on coverage gaps, and weak answers trigger dynamic follow-up probes.

> **Repository layout.** This project ships as **two folders in one repo**:
> - `ai-interviewer/` — the FastAPI **backend**
> - `ai-interviewer-ui/` — the React + Vite **frontend**

---

## Table of contents

1. [Features](#features)
2. [Tech stack](#tech-stack)
3. [Architecture](#architecture)
4. [How scoring & adaptivity work](#how-scoring--adaptivity-work)
5. [Repository structure](#repository-structure)
6. [Setup — Backend](#setup--backend)
7. [Setup — Frontend](#setup--frontend)
8. [API reference](#api-reference)
9. [Environment variables](#environment-variables)
10. [Troubleshooting](#troubleshooting)

---

## Features

| Area | What it does |
|---|---|
| **Seniority auto-detection** | Reads the job description + resume and picks the experience level (`junior` / `mid` / `senior`) and interview type (`technical` / `behavioral` / `mixed`) |
| **Adaptive question generation** | Builds a question bank from the JD + resume, covering all 5 rubric categories, mixing foundational and resume-tailored questions |
| **Follow-up probing** | If an answer is weak, vague, or suspiciously rehearsed, a sharp follow-up question is generated on the spot |
| **Smart question routing** | Picks the next question based on topic-coverage gaps and the quality of the last answer |
| **Transcription** | Groq Whisper API (`whisper-large-v3-turbo`) with automatic fallback to local Whisper |
| **Audio analysis** | Words per minute, pause count, filler words, hedging phrases, confidence-language score |
| **Video analysis** | Eye contact %, gaze direction, posture score + breakdown, position classification, gesture frequency, expression detection (smiling, contempt, smirk, disgust…), drowsiness/fatigue, head-movement pattern, glasses detection, look-away events, micro-expression events |
| **Rubric scoring** | Every answer scored 1–10 on `content`, `communication`, `confidence` plus per-category rubric scores |
| **Detailed report** | Weighted overall score, behavioral heatmap, strengths/weaknesses/red-flags, per-question scores, hire recommendation + confidence |
| **In-memory sessions** | No database. All sessions live in memory and are cleaned up after the report is generated |

---

## Tech stack

**Backend**
- **FastAPI** + **Uvicorn** — API server
- **Groq** — LLM for question generation, answer scoring, follow-up generation, next-question selection, final summary, and seniority detection
- **Groq Whisper API** (`whisper-large-v3-turbo`) — transcription (local `openai-whisper` fallback)
- **MediaPipe** — face landmarks, blendshapes, pose estimation (all on-device)
- **Librosa / NumPy / SciPy** — audio signal processing
- **NLTK** — text / filler-word analysis helpers
- **OpenCV** — video frame processing
- **FFmpeg** — video compression + audio extraction (system dependency)

**Frontend**
- **React + TypeScript + Vite + Tailwind CSS**
- pdf.js — parses PDF resumes client-side
- MediaPipe (@mediapipe/tasks-vision) — pre-interview camera check

---

## Architecture

```
┌──────────────────────────┐         ┌──────────────────────────────────────────────┐
│   React Frontend (UI)    │  HTTP   │              FastAPI Backend                 │
│  Vite dev server :5173   │ ──────► │               :8000  (prefix /api/v1)         │
└──────────────────────────┘         │                                              │
                                     │  routes/interview.py                          │
                                     │   ├ start  ──► generate questions ─► Groq    │
                                     │   ├ detect-seniority ──────────────► Groq    │
                                     │   ├ answer ──► audio + video analysis         │
                                     │   │             ├ Groq Whisper ── transcript  │
                                     │   │             ├ librosa ────── audio signals│
                                     │   │             ├ MediaPipe ─── video signals │
                                     │   │             └ Groq ───────── score answer │
                                     │   ├ skip  ──► record zero-score entry         │
                                     │   └ end   ──► final report ────────► Groq     │
                                     │                                              │
                                     │  core/session_store.py  (in-memory sessions) │
                                     └──────────────────────────────────────────────┘
```

Data flow for one answer:

1. Frontend records a video for the current question and uploads it to `/interview/answer`.
2. The video is compressed with FFmpeg (640×480, CRF 28) for faster processing.
3. Audio is extracted (16 kHz mono WAV) and transcribed with Groq Whisper.
4. Audio signals are computed with librosa: WPM, pauses, filler words, hedging, confidence language.
5. The compressed video is analyzed frame-by-frame with MediaPipe (face landmarks, blendshapes, pose).
6. All signals are sent to Groq which returns content/communication/confidence scores and rubric scores with justification.
7. The entry is stored in the session, topic coverage is updated, and the **next question is chosen** (or a follow-up is generated).
8. When all questions are done, `/interview/end` produces the final report.

---

## How scoring & adaptivity work

### Rubric (weights must sum to 100)

| Category | Default weight |
|---|---|
| `technical_depth` | 35 |
| `problem_solving` | 25 |
| `communication_clarity` | 20 |
| `confidence` | 10 |
| `cultural_fit` | 10 |

### Answer scoring
- The LLM scores each answer 1–10 for `content_score`, `communication_score`, and `confidence_score`.
- Per-category `per_rubric_scores` are only recorded for categories the answer *actually demonstrated* — off-category neutral padding is excluded.
- Semantic similarity (question ↔ answer) is computed with sentence-transformers **if installed**; low similarity forces a low content score (off-topic detection).
- Silent / empty recordings are given a clean zero with `anomaly_flagged: true` instead of being sent to the LLM.

### Adaptive next-question selection
- The question bank is generated up front.
- Uncovered rubric categories are prioritized next.
- If the last answer was weak on an important topic, a **follow-up question** is generated live.
- If the answer seemed rehearsed/suspiciously perfect, a "curveball" follow-up tests genuine understanding.

### Final report
- Weighted overall score (0–100), rescaled by a completion factor so unfinished interviews can't score normally.
- If fewer than 50% of planned questions were answered, the recommendation is forced to `maybe` with `low` confidence.
- Includes strengths, weaknesses, red flags, behavioral heatmap, per-question scores, and interview duration.

---

## Repository structure

```
ai-interviewer/
├── main.py                    # FastAPI app entry point (CORS, router mounting)
├── requirements.txt           # Python dependencies
├── .env                       # GROQ_API_KEY, WHISPER_MODEL  (git-ignored)
├── test_interview.py          # Manual scoring sanity tests
├── routes/
│   └── interview.py           # All API endpoints + ffmpeg helpers
├── core/
│   ├── groq_client.py         # All Groq LLM + model configuration
│   ├── session_store.py       # In-memory session management
│   └── scoring_engine.py      # Weighted scoring, semantic similarity, final report
├── analysis/
│   ├── audio_analyzer.py      # Whisper transcription + librosa audio signals
│   └── video_analyzer.py      # MediaPipe face/pose/blendshape analysis
├── prompts/
│   └── templates.py           # All LLM prompt templates (JSON-output)
└── models/
    └── schemas.py             # Pydantic request/response models
```

---

## Setup — Backend

### Prerequisites
- **Python 3.11** (recommended). Python 3.12 works, but `mediapipe` historically lags behind the newest Python releases — install mediapipe from a wheel for your version if needed.
- **FFmpeg** on your PATH (required for video compression and audio extraction).
  - Windows: `winget install ffmpeg` (or download from ffmpeg.org and add to PATH)
  - Ubuntu/Debian: `sudo apt install ffmpeg`
  - macOS: `brew install ffmpeg`
- A **Groq API key** — https://console.groq.com/keys

### 1. Create a virtual environment and install dependencies

```bash
cd ai-interviewer
python -m venv venv

# Windows (PowerShell)
.\venv\Scripts\Activate.ps1

# macOS / Linux
source venv/bin/activate

pip install -r requirements.txt
```

> On the first run, MediaPipe downloads a ~30 MB face-landmarker model into `~/.cache/mediapipe/`.

### 2. Configure environment variables

Create `.env` in the `ai-interviewer/` folder:

```env
GROQ_API_KEY=your_groq_api_key_here
WHISPER_MODEL=base        # used only for local-whisper fallback
```

### 3. Start the backend

```bash
uvicorn main:app --reload --port 8000
```

The server runs at `http://127.0.0.1:8000`. Verify:

- `GET http://127.0.0.1:8000/health` → `{"status": "ok", "groq_key_set": true}`
- Interactive API docs at `http://127.0.0.1:8000/docs`

---

## Setup — Frontend

The frontend is a **sibling folder** (`ai-interviewer-ui/`).

### 1. Install dependencies

```bash
cd ai-interviewer-ui
npm install
```

### 2. Configure the API URL

Create `.env` in `ai-interviewer-ui/`:

```env
VITE_API_URL=http://127.0.0.1:8000/api/v1
```

### 3. Start the dev server

```bash
npm run dev
```

Open `http://localhost:5173`. Both servers must be running at the same time.

---

## API reference

All endpoints are under the `/api/v1` prefix. CORS is fully open (`*`) so the Vite dev server can call it directly.

### `GET /` — service info
Lists the available endpoints.

### `GET /health` — health check
```json
{ "status": "ok", "groq_key_set": true }
```

### `POST /api/v1/interview/start` — start an interview

Generates the adaptive question bank and returns the first (intro) question.

**Request body (JSON):**
```json
{
  "job_title": "Senior Backend Engineer",
  "job_description": "5+ years Python, REST APIs, system design, Kubernetes...",
  "candidate_name": "Ravi Sharma",
  "candidate_resume": "5 years Python, built REST APIs at Flipkart, led a team of 4...",
  "num_questions": 8,
  "interview_type": "mixed",
  "difficulty": "senior",
  "rubric": {
    "technical_depth": 35,
    "problem_solving": 25,
    "communication_clarity": 20,
    "confidence": 10,
    "cultural_fit": 10
  }
}
```

**Response:**
```json
{
  "session_id": "67f6a1c5-...",
  "candidate_name": "Ravi Sharma",
  "question_id": 0,
  "question": "Welcome, Ravi! Let's start with a quick introduction...",
  "category": "communication_clarity",
  "estimated_duration_minutes": 24,
  "total_questions": 8
}
```

### `POST /api/v1/interview/detect-seniority` — auto-detect level & type

**Request body (JSON):** `{ "job_description": "...", "resume_text": "..." }`

**Response:**
```json
{
  "difficulty": "senior",
  "interview_type": "technical",
  "reasoning": "The role requires 5+ years and leadership, which the resume matches."
}
```

### `POST /api/v1/interview/answer` — submit a video answer (multipart)

**Form fields:** `session_id`, `question_id`, `video` (file)

**Response — another question (status = `ongoing`):**
```json
{
  "status": "ongoing",
  "question_id": 2,
  "question": "How would you handle a database becoming a bottleneck?",
  "category": "problem_solving",
  "is_follow_up": false,
  "questions_remaining": 6,
  "answer_received": { "content_score": 7.5, "anomaly_flagged": false }
}
```

**Response — finished (status = `complete`):**
```json
{
  "status": "complete",
  "message": "All questions answered. Call POST /interview/end to get the full report.",
  "session_id": "67f6a1c5-..."
}
```

### `POST /api/v1/interview/{session_id}/skip` — skip a question

**Request body (JSON):** `{ "question_id": 3 }`

Records a zero-score skipped entry, moves to the next question (same status semantics as `/answer`).

### `POST /api/v1/interview/end` — generate the final report (form)

**Form field:** `session_id`

**Response:** full report
```json
{
  "session_id": "67f6a1c5-...",
  "candidate_name": "Ravi Sharma",
  "job_title": "Senior Backend Engineer",
  "overall_score": 74.2,
  "completion_ratio": 100.0,
  "recommendation": "hire",
  "recommendation_confidence": "medium",
  "summary": "Ravi demonstrated strong technical depth in system design...",
  "strengths": ["In Q1 they described building an event pipeline with Kafka..."],
  "weaknesses": ["Distributed systems trade-offs were shallow..."],
  "red_flags": [],
  "breakdown": { "technical_depth": 7.8, "problem_solving": 6.5, "...": 0 },
  "rubric": { "technical_depth": 35, "...": 10 },
  "per_question_scores": [ { "question_id": 0, "question_text": "...", "answer_text": "...", "audio_signals": {...}, "video_signals": {...}, "content_score": 7.5, "...": 0 } ],
  "behavioral_heatmap": [ { "question_index": 0, "confidence_language": 6.0, "eye_contact_pct": 82.0, "...": 0 } ],
  "interview_duration_minutes": 22.4,
  "topic_coverage": { "technical_depth": 3, "problem_solving": 2, "communication_clarity": 2, "confidence": 1, "cultural_fit": 1 }
}
```

> The session is deleted after `end` is called.

---

## Environment variables

### Backend (`.env` in `ai-interviewer/`)

| Variable | Required | Description |
|---|---|---|
| `GROQ_API_KEY` | ✅ | Groq API key for all LLM + transcription calls |
| `WHISPER_MODEL` | ❌ | Local Whisper model size (`base`, `small`, …) used only as fallback |

### Frontend (`.env` in `ai-interviewer-ui/`)

| Variable | Required | Description |
|---|---|---|
| `VITE_API_URL` | ✅ | Base URL of the backend, e.g. `http://127.0.0.1:8000/api/v1` |

---

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| `404 model_not_found` or errors from Groq | The configured Groq model is not available on your key. Open `core/groq_client.py`. Defaults are `openai/gpt-oss-120b` (smart) and `openai/gpt-oss-20b` (fast). List available models with `curl https://api.groq.com/openai/v1/models -H "Authorization: Bearer $GROQ_API_KEY"`. |
| Seniority detection shows "Using defaults." | The Groq call failed silently. Check the API key is valid and the model in `core/groq_client.py` is accessible to your key. |
| `ffmpeg` not found errors in the logs | Install FFmpeg and make sure it's on your PATH, then restart the backend. |
| Port 8000 already in use | Kill the stale process: `netstat -ano | findstr :8000`, then `taskkill /PID <pid> /F`. |
| MediaPipe errors on Python 3.13+ | Use Python 3.11/3.12 for this project. |
| Frontend CORS / "Not Found" | Verify `VITE_API_URL` points at `http://127.0.0.1:8000/api/v1` and the backend is running. |
| First video answer is slow | Video compression + MediaPipe + transcription take a few seconds. Subsequent answers reuse cached model loads. |