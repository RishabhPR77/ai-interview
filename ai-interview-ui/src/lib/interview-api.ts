const API = (import.meta.env.VITE_API_URL as string | undefined) ?? 'http://127.0.0.1:8000/api/v1'

export interface StartRequest {
  job_title: string
  job_description: string
  candidate_name: string
  candidate_resume: string
  num_questions: number
  interview_type: string
  difficulty: string
  rubric: {
    technical_depth: number
    problem_solving: number
    communication_clarity: number
    confidence: number
    cultural_fit: number
  }
}

export interface StartResponse {
  session_id: string
  candidate_name: string
  question_id: number
  question: string
  category: string
  estimated_duration_minutes: number
  total_questions: number
}

export interface AnswerResponse {
  status: 'ongoing' | 'complete'
  question_id: number
  question: string
  category: string
  is_follow_up: boolean
  questions_remaining: number
  answer_received?: {
    content_score: number
    anomaly_flagged: boolean
  }
  message?: string
  session_id?: string
}

export interface QuestionScore {
  question_id: number
  question_text: string
  answer_text: string
  content_score: number
  communication_score: number
  confidence_score: number
  anomaly_flagged: boolean
  anomaly_reason?: string
  justification?: string
  follow_up_triggered?: boolean
  is_intro?: boolean
  category?: string
  audio_signals?: {
    transcript: string
    words_per_minute: number
    filler_word_count: number
    filler_words_found: string[]
    confidence_language_score: number
    answer_duration_seconds: number
  }
  video_signals?: {
    eye_contact_percentage: number
    posture_score: number
    engagement_score: number
    nervousness_indicators: string[]
    look_away_events: Array<{ start: number; end: number; duration: number }>
    // Rich signals
    attention_arc?: "consistent" | "improving" | "degrading" | "unknown"
    dominant_position?: string
    position_breakdown?: Record<string, number>
    gesture_frequency?: number
    drowsiness_score?: number
    fatigue_trajectory?: "none" | "mild" | "moderate" | "severe"
    yawn_count?: number
    yawn_events?: Array<{ timestamp: number; duration_s: number }>
    looking_down_pct?: number
    head_movement_pattern?: string
    glasses_detected?: boolean
    posture_breakdown?: Record<string, number>
    posture_slump_events?: Array<{ start: number; end: number; duration: number; avg_score: number }>
    micro_expression_events?: Array<{ timestamp: number; type: string; confidence: number }>
    avg_expression_score?: number
    contempt_detected?: boolean
    disgust_detected?: boolean
    smirk_detected?: boolean
    genuine_smile_pct?: number
  }
  question?: string
  answer_transcript?: string
  wpm?: number
  eye_contact_pct?: number
}

export interface ReportResponse {
  session_id: string
  candidate_name: string
  job_title: string
  overall_score: number
  recommendation: string
  recommendation_confidence: string
  summary: string
  strengths: string[]
  weaknesses: string[]
  red_flags: string[]
  breakdown: Record<string, number>
  rubric?: Record<string, number>
  per_question_scores: QuestionScore[]
  behavioral_heatmap: unknown[]
  interview_duration_minutes: number
  topic_coverage: Record<string, number>
}

export interface SeniorityResult {
  difficulty: 'junior' | 'mid' | 'senior'
  interview_type: 'technical' | 'behavioral' | 'mixed'
  reasoning: string
}

export async function detectSeniority(jobDescription: string, resumeText: string): Promise<SeniorityResult> {
  const res = await fetch(`${API}/interview/detect-seniority`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ job_description: jobDescription, resume_text: resumeText }),
  })
  if (!res.ok) throw new Error('Detection failed')
  return res.json()
}

export async function startInterview(req: StartRequest): Promise<StartResponse> {
  const res = await fetch(`${API}/interview/start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(req),
  })
  if (!res.ok) {
    const e = await res.json().catch(() => ({}))
    throw new Error((e as any).detail || `HTTP ${res.status}`)
  }
  return res.json()
}

export async function submitAnswer(
  session_id: string,
  question_id: number,
  video: Blob,
  audioOnly: boolean = false
): Promise<AnswerResponse> {
  const fd = new FormData()
  fd.append('session_id', session_id)
  fd.append('question_id', String(question_id))
  fd.append('video', video, audioOnly ? 'answer_audio_only.webm' : 'answer.webm')
  if (audioOnly) {
    fd.append('is_audio_only', 'true')
  }
  const res = await fetch(`${API}/interview/answer`, { method: 'POST', body: fd })
  if (!res.ok) {
    const e = await res.json().catch(() => ({}))
    throw new Error((e as any).detail || `HTTP ${res.status}`)
  }
  return res.json()
}

export async function skipQuestion(session_id: string, question_id: number): Promise<AnswerResponse> {
  const res = await fetch(`${API}/interview/${session_id}/skip`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ question_id }),
  })
  if (!res.ok) {
    const e = await res.json().catch(() => ({}))
    throw new Error((e as any).detail || `HTTP ${res.status}`)
  }
  return res.json()
}

export async function endInterview(session_id: string): Promise<ReportResponse> {
  const fd = new FormData()
  fd.append('session_id', session_id)
  const res = await fetch(`${API}/interview/end`, { method: 'POST', body: fd })
  if (!res.ok) {
    const e = await res.json().catch(() => ({}))
    throw new Error((e as any).detail || `HTTP ${res.status}`)
  }
  const report: ReportResponse = await res.json()
  report.per_question_scores = (report.per_question_scores || []).map(q => ({
    ...q,
    question: q.question_text || q.question,
    answer_transcript: q.answer_text || q.answer_transcript,
    wpm: q.audio_signals?.words_per_minute ?? q.wpm,
    eye_contact_pct: q.video_signals?.eye_contact_percentage ?? q.eye_contact_pct,
  }))
  return report
}

export async function parseFileToText(file: File): Promise<string> {
  if (file.type === 'text/plain') return file.text()
  if (file.type === 'application/pdf') {
    const pdfjsLib = await import('pdfjs-dist')
    pdfjsLib.GlobalWorkerOptions.workerSrc =
      `https://unpkg.com/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.mjs`
    const buf = await file.arrayBuffer()
    const pdf = await pdfjsLib.getDocument({ data: buf }).promise
    let text = ''
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i)
      const content = await page.getTextContent()
      text += content.items.map((item: any) => item.str).join(' ') + '\n'
    }
    return text.trim()
  }
  throw new Error('Unsupported file type. Use PDF or TXT.')
}