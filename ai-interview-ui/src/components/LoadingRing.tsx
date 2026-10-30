// The app's loading indicator: an orange comet sweeping a faint track with a thin
// counter-rotating ring inside. Pass `progress` (0–1) to show real progress on the
// outer ring instead; `children` go in the centre.
import { useId, type ReactNode } from 'react'

const OUTER = 2 * Math.PI * 44

export function LoadingRing({ size = 112, progress, children }: {
  size?: number
  progress?: number
  children?: ReactNode
}) {
  const id = useId()
  const determinate = progress != null
  const done = Math.min(1, Math.max(0, progress ?? 0))

  return (
    <div className="relative inline-flex items-center justify-center shrink-0" style={{ width: size, height: size }} role="status" aria-label="Loading">
      <div className="absolute inset-[18%] rounded-full bg-primary/15 blur-xl ring-breathe" />
      <svg viewBox="0 0 100 100" className="absolute inset-0 w-full h-full" aria-hidden="true">
        <defs>
          <linearGradient id={id} x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor="var(--primary)" stopOpacity="0" />
            <stop offset="0.55" stopColor="var(--primary)" stopOpacity="0.55" />
            <stop offset="1" stopColor="var(--primary)" />
          </linearGradient>
        </defs>

        <circle cx="50" cy="50" r="44" fill="none" stroke="var(--border)" strokeWidth="3" />

        {determinate ? (
          <circle
            cx="50" cy="50" r="44" fill="none" stroke="var(--primary)" strokeWidth="5" strokeLinecap="round"
            strokeDasharray={OUTER} strokeDashoffset={OUTER * (1 - done)}
            transform="rotate(-90 50 50)" style={{ transition: 'stroke-dashoffset 0.7s cubic-bezier(.2,.7,.2,1)' }}
          />
        ) : (
          <g className="ring-orbit">
            <path d="M 6 50 A 44 44 0 0 1 94 50" fill="none" stroke={`url(#${id})`} strokeWidth="5" strokeLinecap="round" />
            <circle cx="94" cy="50" r="3.6" fill="var(--primary)" />
          </g>
        )}

        <g className="ring-orbit-reverse">
          <circle cx="50" cy="50" r="34" fill="none" stroke="var(--foreground)" strokeOpacity="0.28" strokeWidth="1.5"
            strokeLinecap="round" strokeDasharray="46 168" />
        </g>
      </svg>
      {children ?? <span className="w-[12%] h-[12%] rounded-full bg-primary ring-breathe" />}
    </div>
  )
}
