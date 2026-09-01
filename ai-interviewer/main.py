import os
from dotenv import load_dotenv
load_dotenv()

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from routes.interview import router as interview_router

app = FastAPI(
    title="AI Interviewer",
    description="Advanced AI-powered interview system with video, audio, gesture and expression analysis",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(interview_router, prefix="/api/v1", tags=["Interview"])


@app.get("/")
def root():
    return {
        "status": "running",
        "endpoints": {
            "start": "POST /api/v1/interview/start",
            "answer": "POST /api/v1/interview/answer  (multipart: session_id, question_id, video file)",
            "end": "POST /api/v1/interview/end  (form: session_id)",
        }
    }


@app.get("/health")
def health():
    return {"status": "ok", "groq_key_set": bool(os.getenv("GROQ_API_KEY"))}
