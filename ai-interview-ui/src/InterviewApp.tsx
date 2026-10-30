import { useCallback, useState } from 'react'
import { SetupScreen } from './components/interview/SetupScreen'
import { CameraCheckScreen } from './components/interview/CameraCheckScreen'
import { PreInterviewScreen } from './components/interview/PreInterviewScreen'
import { InterviewScreen } from './components/interview/InterviewScreen'
import { ReportScreen } from './components/interview/ReportScreen'
import { ReportPreparingScreen } from './components/interview/ReportPreparingScreen'
import { getInterviewState, type StartResponse, type ReportResponse } from './lib/interview-api'
import { ApiError } from './lib/api'
import { navigate } from './lib/router'

type Screen = 'setup' | 'camera-check' | 'pre-interview' | 'interview' | 'preparing' | 'report'

const SESSION_KEY = 'tejaskrit_session'
// Finished reports are kept server-side for 24h; this remembers the latest one.
const LAST_REPORT_KEY = 'tejaskrit_last_report'

interface LastReport {
  session_id: string
  candidateName: string
  jobTitle: string
  expires_at: string
}

function readLastReport(): LastReport | null {
  try {
    const raw = localStorage.getItem(LAST_REPORT_KEY)
    if (!raw) return null
    const saved: LastReport = JSON.parse(raw)
    if (new Date(saved.expires_at).getTime() > Date.now()) return saved
    localStorage.removeItem(LAST_REPORT_KEY)
  } catch {
    /* storage unavailable or corrupt */
  }
  return null
}

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

/** The report opened from an email link: /app?report=<session id> */
const linkedReport = () => new URLSearchParams(window.location.search).get('report')

export function InterviewApp() {
  const [screen, setScreen] = useState<Screen>(() => (linkedReport() ? 'preparing' : 'setup'))
  const [preparing, setPreparing] = useState<{ sessionId: string; finish: boolean } | null>(() => {
    const id = linkedReport()
    return id ? { sessionId: id, finish: false } : null
  })
  const [startData, setStartData] = useState<StartResponse | null>(null)
  const [ctx, setCtx] = useState<{ candidateName: string; jobTitle: string }>({ candidateName: '', jobTitle: '' })
  const [report, setReport] = useState<ReportResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [savedSession, setSavedSession] = useState<SavedSession | null>(() => {
    try {
      const raw = localStorage.getItem(SESSION_KEY)
      return raw ? JSON.parse(raw) : null
    } catch {
      localStorage.removeItem(SESSION_KEY)
      return null
    }
  })
  const [endedEarly, setEndedEarly] = useState(false)
  const [lastReport, setLastReport] = useState<LastReport | null>(readLastReport)
  const [opening, setOpening] = useState(false)

  const handleStarted = (data: StartResponse, context: { candidateName: string; jobTitle: string }) => {
    setStartData(data)
    setCtx(context)
    setError(null)
    setSavedSession(null)
    setScreen('camera-check')
  }

  const rememberReport = useCallback((pointer: LastReport) => {
    try { localStorage.setItem(LAST_REPORT_KEY, JSON.stringify(pointer)) } catch { /* storage unavailable */ }
    setLastReport(pointer)
  }, [])

  const showReport = useCallback((r: ReportResponse) => {
    setCtx({ candidateName: r.candidate_name, jobTitle: r.job_title })
    setReport(r)
    if (r.session_id && r.report_expires_at) {
      rememberReport({ session_id: r.session_id, candidateName: r.candidate_name, jobTitle: r.job_title, expires_at: r.report_expires_at })
    }
    setScreen('report')
  }, [rememberReport])

  const openLastReport = () => {
    if (!lastReport) return
    setPreparing({ sessionId: lastReport.session_id, finish: false })
    setScreen('preparing')
  }

  const handleReportMissing = useCallback(() => {
    localStorage.removeItem(LAST_REPORT_KEY)
    setLastReport(null)
    setPreparing(null)
    setError('That report has expired or isn’t available.')
    navigate('/app', { replace: true })
    setScreen('setup')
  }, [])

  /** The interview is over: leave for the screen that waits for the report. */
  const startPreparing = (sessionId: string, candidateName: string, jobTitle: string) => {
    localStorage.removeItem(SESSION_KEY)
    setSavedSession(null)
    setPreparing({ sessionId, finish: true })
    rememberReport({ session_id: sessionId, candidateName, jobTitle, expires_at: new Date(Date.now() + 24 * 3600 * 1000).toISOString() })
    setScreen('preparing')
  }

  const handleResume = async (saved: SavedSession) => {
    setOpening(true)
    setError(null)
    // Ask the server where this interview really is — it may have finished
    // (report ready) or moved past the question saved in this browser.
    let state: Awaited<ReturnType<typeof getInterviewState>> | null = null
    try {
      state = await getInterviewState(saved.session_id)
      if (state.status === 'complete') {
        startPreparing(saved.session_id, saved.candidateName, saved.jobTitle)
        return
      }
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) {
        localStorage.removeItem(SESSION_KEY)
        setSavedSession(null)
        setPreparing({ sessionId: saved.session_id, finish: false })
        setScreen('preparing')
        return
      }
      // Network trouble: fall back to what this browser saved.
    } finally {
      setOpening(false)
    }
    const reconstructed: StartResponse = {
      session_id: saved.session_id,
      candidate_name: saved.candidateName,
      question_id: state?.question_id ?? saved.question_id,
      question: state?.question ?? saved.question,
      category: state?.category ?? saved.category,
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

  const handleComplete = (early?: boolean) => {
    document.exitFullscreen?.().catch(() => { })
    setEndedEarly(!!early)
    if (startData) startPreparing(startData.session_id, ctx.candidateName, ctx.jobTitle)
  }

  const handleError = (msg: string) => setError(msg)

  const handleRestart = () => {
    setStartData(null)
    setReport(null)
    setPreparing(null)
    setError(null)
    setEndedEarly(false)
    localStorage.removeItem(SESSION_KEY)
    navigate('/app', { replace: true })
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
              disabled={opening}
              className="px-3 py-1 rounded-md bg-primary-foreground text-primary font-medium text-xs hover:bg-primary-foreground/90 disabled:opacity-60 transition"
            >
              {opening ? 'Checking…' : 'Resume'}
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

      {screen === 'setup' && !savedSession && lastReport && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 w-[calc(100%-2rem)] max-w-xl bg-surface/95 backdrop-blur border border-border rounded-2xl shadow-2xl px-4 py-3 flex items-center gap-3 text-sm">
          <span className="flex-1 min-w-0 truncate">
            Your report for <strong>{lastReport.jobTitle}</strong> is still available
            <span className="text-muted-foreground"> · until {new Date(lastReport.expires_at).toLocaleString([], { hour: '2-digit', minute: '2-digit', day: 'numeric', month: 'short' })}</span>
          </span>
          <button
            onClick={openLastReport}
            disabled={opening}
            className="shrink-0 px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 disabled:opacity-60 transition"
          >
            {opening ? 'Opening…' : 'Open report'}
          </button>
          <button
            onClick={() => { localStorage.removeItem(LAST_REPORT_KEY); setLastReport(null) }}
            aria-label="Dismiss"
            className="shrink-0 text-muted-foreground hover:text-foreground text-xs px-1"
          >
            ✕
          </button>
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

      {screen === 'preparing' && preparing && (
        <ReportPreparingScreen
          sessionId={preparing.sessionId}
          finish={preparing.finish}
          onReady={showReport}
          onMissing={handleReportMissing}
          onRestart={handleRestart}
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