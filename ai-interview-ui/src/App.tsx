import { useEffect, useState } from 'react'
import { SetupScreen } from './components/interview/SetupScreen'
import { CameraCheckScreen } from './components/interview/CameraCheckScreen'
import { PreInterviewScreen } from './components/interview/PreInterviewScreen'
import { InterviewScreen } from './components/interview/InterviewScreen'
import { ReportScreen } from './components/interview/ReportScreen'
import type { StartResponse, ReportResponse } from './lib/interview-api'

type Screen = 'setup' | 'camera-check' | 'pre-interview' | 'interview' | 'report'

const SESSION_KEY = 'tejaskrit_session'

export interface SavedSession {
  session_id: string
  candidate_name: string
  question_id: number
  question: string
  category: string
  total_questions: number
  qIndex: number
  candidateName: string
  jobTitle: string
}

// Default rubric — matches SetupScreen hardcoded values
const DEFAULT_RUBRIC = {
  technical_depth: 35,
  problem_solving: 25,
  communication_clarity: 20,
  confidence: 10,
  cultural_fit: 10,
}

export default function App() {
  const [screen, setScreen] = useState<Screen>('setup')
  const [startData, setStartData] = useState<StartResponse | null>(null)
  const [ctx, setCtx] = useState<{ candidateName: string; jobTitle: string }>({ candidateName: '', jobTitle: '' })
  const [report, setReport] = useState<ReportResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [savedSession, setSavedSession] = useState<SavedSession | null>(null)
  const [endedEarly, setEndedEarly] = useState(false)

  useEffect(() => {
    try {
      const raw = localStorage.getItem(SESSION_KEY)
      if (raw) setSavedSession(JSON.parse(raw))
    } catch {
      localStorage.removeItem(SESSION_KEY)
    }
  }, [])

  const handleStarted = (data: StartResponse, context: { candidateName: string; jobTitle: string }) => {
    setStartData(data)
    setCtx(context)
    setError(null)
    setSavedSession(null)
    setScreen('camera-check')
  }

  const handleResume = (saved: SavedSession) => {
    const reconstructed: StartResponse = {
      session_id: saved.session_id,
      candidate_name: saved.candidateName,
      question_id: saved.question_id,
      question: saved.question,
      category: saved.category,
      estimated_duration_minutes: saved.total_questions * 3,
      total_questions: saved.total_questions,
    }
    setStartData(reconstructed)
    setCtx({ candidateName: saved.candidateName, jobTitle: saved.jobTitle })
    setError(null)
    setSavedSession(null)
    setScreen('camera-check')
  }

  const handleDismissSaved = () => {
    localStorage.removeItem(SESSION_KEY)
    setSavedSession(null)
  }

  const handleComplete = (r: ReportResponse, early?: boolean) => {
    document.exitFullscreen?.().catch(() => { })
    localStorage.removeItem(SESSION_KEY)
    setReport(r)
    setEndedEarly(!!early)
    setScreen('report')
  }

  const handleError = (msg: string) => setError(msg)

  const handleRestart = () => {
    setStartData(null)
    setReport(null)
    setError(null)
    setEndedEarly(false)
    localStorage.removeItem(SESSION_KEY)
    setScreen('setup')
  }

  return (
    <>
      {screen === 'setup' && savedSession && (
        <div className="fixed top-0 inset-x-0 z-50 bg-primary/95 backdrop-blur border-b border-primary/30 px-4 py-3 flex items-center justify-between gap-4 text-primary-foreground text-sm">
          <span>
            ↩ Resume previous interview for <strong>{savedSession.candidateName}</strong> — <em>{savedSession.jobTitle}</em>
            <span className="ml-2 opacity-70">(Question {savedSession.qIndex} of {savedSession.total_questions})</span>
          </span>
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={() => handleResume(savedSession)}
              className="px-3 py-1 rounded-md bg-primary-foreground text-primary font-medium text-xs hover:bg-primary-foreground/90 transition"
            >
              Resume
            </button>
            <button
              onClick={handleDismissSaved}
              className="px-3 py-1 rounded-md border border-primary-foreground/30 text-xs hover:bg-primary-foreground/10 transition"
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

      {screen === 'setup' && (
        <div className={savedSession ? 'pt-14' : ''}>
          <SetupScreen onStarted={handleStarted} />
        </div>
      )}

      {screen === 'camera-check' && (
        <CameraCheckScreen
          candidateName={ctx.candidateName}
          onReady={() => setScreen('pre-interview')}
          onBack={() => setScreen('setup')}
        />
      )}

      {screen === 'pre-interview' && startData && (
        <PreInterviewScreen
          start={startData}
          jobTitle={ctx.jobTitle}
          candidateName={ctx.candidateName}
          rubric={DEFAULT_RUBRIC}
          onBegin={() => setScreen('interview')}
          onBack={() => setScreen('camera-check')}
        />
      )}

      {screen === 'interview' && startData && (
        <InterviewScreen
          start={startData}
          candidateName={ctx.candidateName}
          jobTitle={ctx.jobTitle}
          onComplete={handleComplete}
          onError={handleError}
        />
      )}

      {screen === 'report' && report && (
        <ReportScreen
          report={report}
          candidateName={ctx.candidateName}
          jobTitle={ctx.jobTitle}
          onRestart={handleRestart}
          endedEarly={endedEarly}
        />
      )}

      {error && screen !== 'interview' && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[9999] flex items-center gap-2 bg-destructive text-destructive-foreground text-sm font-medium px-5 py-3 rounded-xl shadow-lg border border-destructive/30">
          <span>⚠</span>
          {error}
        </div>
      )}
    </>
  )
}