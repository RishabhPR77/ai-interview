from pydantic import BaseModel, Field, field_validator, model_validator
from typing import Optional, Dict, List, Any


class Rubric(BaseModel):
    technical_depth: int = Field(default=35, ge=0, le=100)
    problem_solving: int = Field(default=25, ge=0, le=100)
    communication_clarity: int = Field(default=20, ge=0, le=100)
    confidence: int = Field(default=10, ge=0, le=100)
    cultural_fit: int = Field(default=10, ge=0, le=100)

    @model_validator(mode="after")
    def validate_weights(self) -> "Rubric":
        total = (
            self.technical_depth
            + self.problem_solving
            + self.communication_clarity
            + self.confidence
            + self.cultural_fit
        )
        if total != 100:
            raise ValueError(f"Rubric weights must sum to 100, got {total}")
        return self


class StartInterviewRequest(BaseModel):
    job_title: str
    job_description: str
    candidate_name: str
    candidate_resume: str
    num_questions: int = Field(default=6, ge=3, le=12)
    interview_type: str = Field(default="mixed")  # technical | behavioral | mixed
    difficulty: str = Field(default="mid")         # junior | mid | senior | lead
    rubric: Rubric = Field(default_factory=Rubric)

    @field_validator("candidate_resume")
    @classmethod
    def resume_must_not_be_empty(cls, v: str) -> str:
        if not v or not v.strip():
            raise ValueError(
                "Resume is required. Please upload or paste your resume before starting the interview."
            )
        if len(v.strip()) < 50:
            raise ValueError(
                "Resume seems too short. Please provide a complete resume (at least a few sentences)."
            )
        return v.strip()


class StartInterviewResponse(BaseModel):
    session_id: str
    candidate_name: str
    question_id: int
    question: str
    category: str
    estimated_duration_minutes: int
    total_questions: int


class AnswerRequest(BaseModel):
    session_id: str
    question_id: int


class AudioSignals(BaseModel):
    transcript: str
    words_per_minute: float
    pause_count: int
    filler_word_count: int
    filler_words_found: List[str]
    answer_duration_seconds: float
    confidence_language_score: float   # 0-10, higher = more assertive language
    hedging_count: int


class VideoSignals(BaseModel):
    eye_contact_percentage: float      # % of time looking at camera
    avg_expression_score: float        # 0-10 calmness/confidence
    posture_score: float               # 0-10
    gesture_frequency: float           # gestures per minute
    nervousness_indicators: List[str]  # e.g. ["lip_press", "gaze_aversion"]
    engagement_score: float            # 0-10
    expression_timeline: List[Dict]    # [ {second: 5, expression: "neutral", confidence: 0.9} ]


class QuestionScore(BaseModel):
    question_id: int
    question_text: str
    answer_text: str
    audio_signals: Optional[AudioSignals]
    video_signals: Optional[VideoSignals]
    content_score: float               # 0-10
    communication_score: float         # 0-10
    confidence_score: float            # 0-10
    anomaly_flagged: bool
    anomaly_reason: Optional[str]
    follow_up_triggered: bool
    follow_up_reason: Optional[str]
    per_rubric_scores: Dict[str, float]
    justification: str


class FinalReport(BaseModel):
    session_id: str
    candidate_name: str
    job_title: str
    overall_score: float               # 0-100
    recommendation: str                # hire | no_hire | maybe
    recommendation_confidence: str     # high | medium | low
    summary: str
    strengths: List[str]
    weaknesses: List[str]
    red_flags: List[str]
    breakdown: Dict[str, float]        # per rubric category weighted score
    per_question_scores: List[QuestionScore]
    behavioral_heatmap: List[Dict]     # timeline: [{minute, confidence, engagement, nervousness}]
    interview_duration_minutes: float
    topic_coverage: Dict[str, int]     # how many times each rubric area was probed