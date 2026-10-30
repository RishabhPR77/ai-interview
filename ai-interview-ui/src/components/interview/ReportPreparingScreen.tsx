// Shown after the interview ends, and when opening a report from its email link.
// The server analyses answers in the background, so this polls until the report
// is ready. The candidate can safely leave: they're emailed when it's done.
import { useEffect, useState } from 'react'
import { AlertTriangle, Mail, RotateCcw } from 'lucide-react'
import { LoadingRing } from '@/components/LoadingRing'
import { ApiError } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { finishInterview, getReport, getReportStatus, type ReportResponse } from '@/lib/interview-api'

const POLL_MS = 3000
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

export function ReportPreparingScreen({ sessionId, finish, onReady, onMissing, onRestart }: {
  sessionId: string
  /** End the interview first (false when just opening an existing report). */
  finish: boolean
  onReady: (report: ReportResponse) => void
  onMissing: () => void
  onRestart: () => void
}) {
  const { user } = useAuth()
  const [progress, setProgress] = useState({ analysed: 0, total: 0 })
  const [failure, setFailure] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let cancelled = false

    async function run() {
      let mustEnd = finish || attempt > 0
      while (!cancelled) {
        try {
          if (mustEnd) {
            const ended = await finishInterview(sessionId)
            if (cancelled) return
            if (ended.report) return onReady(ended.report)
            mustEnd = false
          }
          const status = await getReportStatus(sessionId)
          if (cancelled) return
          if (status.status === 'ready') return onReady(await getReport(sessionId))
          if (status.status === 'failed') return setFailure(status.detail ?? 'We couldn’t generate your report.')
          if (status.status === 'ongoing') mustEnd = true
          else setProgress({ analysed: status.analysed ?? 0, total: status.total ?? 0 })
        } catch (e) {
          if (cancelled) return
          if (e instanceof ApiError && e.status === 404) return onMissing()
          // Connection blips and "last answer still processing": keep trying.
          if (e instanceof ApiError && e.code === 'answer_processing') mustEnd = true
        }
        await sleep(POLL_MS)
      }
    }
    run()
    return () => { cancelled = true }
  }, [sessionId, finish, attempt, onReady, onMissing])

  const { analysed, total } = progress
  const allAnalysed = total > 0 && analysed >= total
  const share = total ? analysed / total : 0
  const headline = allAnalysed ? 'Writing your report…' : total ? `Analysing answer ${Math.min(analysed + 1, total)} of ${total}` : 'Getting started…'

  return (
    <div className="min-h-[100dvh] bg-app flex items-center justify-center px-4 py-10 screen-enter">
      <div className="w-full max-w-md text-center">
        {failure ? (
          <>
            <div className="mx-auto w-16 h-16 rounded-full bg-destructive/10 border border-destructive/30 flex items-center justify-center">
              <AlertTriangle className="w-7 h-7 text-destructive" />
            </div>
            <h1 className="mt-6 font-serif text-3xl">Your report hit a snag</h1>
            <p className="mt-3 text-sm text-muted-foreground leading-relaxed">{failure} Your answers are safe.</p>
            <button
              onClick={() => { setFailure(null); setAttempt(a => a + 1) }}
              className="mt-6 inline-flex items-center gap-2 bg-primary text-primary-foreground font-medium px-5 py-3 rounded-xl hover:bg-primary/90 transition"
            >
              <RotateCcw className="w-4 h-4" /> Try again
            </button>
          </>
        ) : (
          <>
            <div className="flex justify-center">
              <LoadingRing size={160} progress={total ? Math.max(0.04, share) : undefined}>
                {total > 0 && <span className="font-serif text-4xl">{Math.round(share * 100)}<span className="text-lg text-muted-foreground">%</span></span>}
              </LoadingRing>
            </div>
            <div className="mt-8 text-[11px] uppercase tracking-[0.2em] text-primary font-semibold">Interview complete</div>
            <h1 className="mt-2 font-serif text-3xl sm:text-4xl leading-tight">{headline}</h1>
            <p className="mt-3 text-sm text-muted-foreground leading-relaxed">
              We’re reviewing your video, delivery and answers. This usually takes a few minutes.
            </p>
            <div className="mt-6 rounded-2xl border border-border bg-surface px-5 py-4 text-sm flex items-start gap-3 text-left">
              <Mail className="w-5 h-5 text-primary shrink-0 mt-0.5" />
              <span>
                <strong>No need to wait here.</strong>{' '}
                <span className="text-muted-foreground">You can close this page. We’ll email {user?.email ?? 'you'} a link as soon as your report is ready.</span>
              </span>
            </div>
          </>
        )}
        <button onClick={onRestart} className="mt-5 text-sm text-muted-foreground hover:text-foreground underline underline-offset-4 transition">
          Back to practice
        </button>
      </div>
    </div>
  )
}
