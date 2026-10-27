// Looping walkthrough for the landing page: a pointer moves through a simplified
// version of the app (sign in → key + model → job & resume → answer → report),
// so visitors see how to use it before signing up. Elements are positioned in
// percentages of the stage so the pointer's targets line up at every size.
import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion, useInView, useReducedMotion } from 'framer-motion'
import { Check, ChevronDown, FileDown, Loader2, Mic, PlayCircle, Sparkles } from 'lucide-react'

const TICK_MS = 100
const SCENE_TICKS = 50 // 5 seconds per step

type Waypoint = { at: number; x: number; y: number; click?: boolean }

const STEPS: { title: string; caption: string; path: string; cursor: Waypoint[] }[] = [
  {
    title: 'Sign in with your email',
    caption: 'No password — we email you a 6-digit code.',
    path: '/login',
    cursor: [{ at: 0, x: 82, y: 88 }, { at: 4, x: 50, y: 41, click: true }, { at: 24, x: 50, y: 57, click: true }, { at: 36, x: 62, y: 76 }],
  },
  {
    title: 'Add your AI key, pick a model',
    caption: 'Paste a key from Groq, OpenAI, Gemini, Anthropic or OpenRouter, then choose models from the list.',
    path: '/settings',
    cursor: [{ at: 0, x: 85, y: 92 }, { at: 3, x: 40, y: 23 }, { at: 12, x: 77, y: 23, click: true }, { at: 20, x: 50, y: 49, click: true }, { at: 28, x: 50, y: 59, click: true }, { at: 38, x: 50, y: 87, click: true }],
  },
  {
    title: 'Paste the job and your resume',
    caption: 'The questions are written for that exact role and your experience.',
    path: '/app',
    cursor: [{ at: 0, x: 80, y: 92 }, { at: 3, x: 27, y: 42, click: true }, { at: 16, x: 73, y: 42, click: true }, { at: 32, x: 50, y: 84, click: true }],
  },
  {
    title: 'Answer out loud, on camera',
    caption: 'Like the real thing. Vague answers get a follow-up question.',
    path: '/app',
    cursor: [{ at: 0, x: 80, y: 92 }, { at: 11, x: 50, y: 85, click: true }, { at: 21, x: 74, y: 62 }, { at: 37, x: 50, y: 85, click: true }],
  },
  {
    title: 'Read your report',
    caption: 'Scores for content, delivery and presence, with strengths, gaps and a PDF.',
    path: '/report',
    cursor: [{ at: 0, x: 82, y: 92 }, { at: 8, x: 25, y: 44 }, { at: 22, x: 70, y: 40 }, { at: 36, x: 77, y: 85, click: true }],
  },
]

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
/** Characters of `text` revealed `perTick` at a time from tick `start`. */
const typed = (text: string, t: number, start: number, perTick = 1) => text.slice(0, clamp((t - start) * perTick, 0, text.length))
const at = (top: number, left: number, right: number, height?: number) =>
  ({ top: `${top}%`, left: `${left}%`, right: `${right}%`, ...(height ? { height: `${height}%` } : {}) })

const field = 'absolute rounded-lg border bg-app/70 flex items-center px-[3%] text-[clamp(8px,1.5vw,13px)] transition-colors'
const button = 'absolute rounded-lg flex items-center justify-center gap-1.5 font-medium text-[clamp(8px,1.5vw,13px)] transition-colors'
const label = 'absolute text-[clamp(7px,1.2vw,11px)] uppercase tracking-wider text-muted-foreground'

function SignIn({ t }: { t: number }) {
  const email = typed('you@example.com', t, 7)
  const code = '482915'.slice(0, clamp(t - 30, 0, 6))
  return (
    <div className="absolute rounded-2xl border border-border bg-surface" style={at(10, 20, 20, 82)}>
      <div className="absolute w-full text-center font-serif text-[clamp(10px,2vw,18px)]" style={{ top: '6%' }}>Sign in to tejaskrit</div>
      <div className={label} style={at(20, 10, 10)}>Email</div>
      <div className={`${field} ${t >= 5 && t < 24 ? 'border-primary/60' : 'border-border'}`} style={at(28, 10, 10, 12)}>
        {email || <span className="text-muted-foreground/50">you@example.com</span>}
        {t >= 5 && t < 24 && <span className="w-px h-[60%] bg-foreground ml-0.5 animate-pulse" />}
      </div>
      <div className={`${button} ${t >= 24 && t < 28 ? 'bg-primary/80' : 'bg-primary'} text-primary-foreground`} style={at(48, 10, 10, 12)}>
        {t >= 26 ? <><Check className="w-[1em] h-[1em]" /> Code sent</> : 'Send code'}
      </div>
      {t >= 28 && (
        <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="absolute flex justify-center gap-[2%]" style={at(70, 10, 10, 12)}>
          {Array.from({ length: 6 }, (_, i) => (
            <div key={i} className={`h-full aspect-[4/5] rounded-md border flex items-center justify-center font-mono text-[clamp(8px,1.6vw,14px)] ${code[i] ? 'border-primary/60 bg-primary/10' : 'border-border'}`}>
              {code[i] ?? ''}
            </div>
          ))}
        </motion.div>
      )}
    </div>
  )
}

function Settings({ t }: { t: number }) {
  const keyChars = clamp(t - 4, 0, 12)
  const connected = t >= 14
  const open = t >= 21 && t < 29
  const picked = t >= 29
  return (
    <>
      <div className={label} style={at(11, 8, 8)}>Groq API key</div>
      <div className={`${field} font-mono ${t >= 4 && t < 13 ? 'border-primary/60' : 'border-border'}`} style={at(17, 8, 34, 11)}>
        {keyChars ? `gsk_${'•'.repeat(keyChars)}` : <span className="text-muted-foreground/50 font-sans">Paste your API key</span>}
      </div>
      <div className={`${button} ${connected ? 'bg-success/15 text-success border border-success/40' : 'bg-primary text-primary-foreground'}`} style={at(17, 69, 8, 11)}>
        {connected ? <><Check className="w-[1em] h-[1em]" /> Connected</> : 'Verify & save'}
      </div>
      <div className={label} style={at(37, 8, 8)}>Evaluation model</div>
      <div className={`${field} justify-between ${open ? 'border-primary/60' : 'border-border'}`} style={at(43, 8, 8, 11)}>
        <span className="flex items-center gap-1.5">{picked ? <>GPT-OSS 120B <Sparkles className="w-[1em] h-[1em] text-primary" /></> : <span className="text-muted-foreground/60">Choose a model</span>}</span>
        <ChevronDown className="w-[1.1em] h-[1.1em] text-muted-foreground" />
      </div>
      <AnimatePresence>
        {open && (
          <motion.div initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
            className="absolute rounded-lg border border-border bg-surface shadow-2xl overflow-hidden z-10" style={at(55, 8, 8, 25)}>
            {[['GPT-OSS 120B', '131K context', true], ['GPT-OSS 20B', '131K context', true], ['Qwen 3.8 27B', '131K context', false]].map(([n, d, rec], i) => (
              <div key={String(n)} className={`h-1/3 flex items-center justify-between px-[3%] text-[clamp(8px,1.4vw,12px)] ${i === 0 ? 'bg-primary/10' : ''}`}>
                <span className="flex items-center gap-1.5">{n} {rec && <Sparkles className="w-[1em] h-[1em] text-primary" />}</span>
                <span className="text-muted-foreground">{d}</span>
              </div>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
      <div className={`${button} ${picked ? 'bg-primary text-primary-foreground glow-primary' : 'bg-secondary text-muted-foreground'}`} style={at(82, 30, 30, 11)}>
        <PlayCircle className="w-[1.2em] h-[1.2em]" /> Start interview
      </div>
    </>
  )
}

function JobAndResume({ t }: { t: number }) {
  const jd = clamp(Math.floor((t - 4) / 2), 0, 6)
  const cv = clamp(Math.floor((t - 17) / 2), 0, 6)
  const box = (title: string, lines: number, left: number, right: number, focused: boolean) => (
    <div className={`absolute rounded-xl border bg-app/60 p-[2.5%] ${focused ? 'border-primary/60' : 'border-border'}`} style={{ ...at(10, left, right), bottom: '30%' }}>
      <div className="text-[clamp(7px,1.2vw,11px)] uppercase tracking-wider text-muted-foreground mb-[6%]">{title}</div>
      <div className="space-y-[5%]">
        {Array.from({ length: lines }, (_, i) => (
          <motion.div key={i} initial={{ width: 0 }} animate={{ width: `${[92, 78, 85, 64, 88, 55][i]}%` }} className="h-[0.55em] rounded-full bg-foreground/15" style={{ fontSize: 'clamp(8px,1.4vw,12px)' }} />
        ))}
      </div>
    </div>
  )
  return (
    <>
      {box('Job description', jd, 6, 52, t >= 3 && t < 16)}
      {box('Your resume', cv, 52, 6, t >= 16 && t < 30)}
      <div className={`${button} ${cv >= 6 ? 'bg-primary text-primary-foreground' : 'bg-secondary text-muted-foreground'}`} style={at(78, 32, 32, 12)}>
        {t >= 34 ? <><Loader2 className="w-[1em] h-[1em] animate-spin" /> Writing your questions…</> : 'Start interview'}
      </div>
    </>
  )
}

function Answer({ t }: { t: number }) {
  const recording = t >= 13 && t < 39
  const seconds = recording ? Math.floor((t - 13) / 2) : 0
  return (
    <>
      <div className="absolute rounded-xl border border-border bg-gradient-to-b from-secondary/60 to-app overflow-hidden" style={{ ...at(10, 6, 50), bottom: '28%' }}>
        <div className="absolute left-1/2 -translate-x-1/2 bottom-0 w-[46%] aspect-square rounded-t-full bg-foreground/10" />
        <div className="absolute left-1/2 -translate-x-1/2 bottom-[38%] w-[24%] aspect-square rounded-full bg-foreground/15" />
        {recording && (
          <div className="absolute top-[6%] left-[5%] flex items-center gap-1 text-[clamp(7px,1.2vw,11px)] text-destructive font-medium">
            <span className="w-[0.6em] h-[0.6em] rounded-full bg-destructive animate-pulse" /> REC 0:{String(seconds).padStart(2, '0')}
          </div>
        )}
        {recording && (
          <div className="absolute bottom-[6%] left-[8%] right-[8%] h-[12%] flex items-end gap-[2%]">
            {Array.from({ length: 16 }, (_, i) => (
              <div key={i} className="flex-1 rounded-full bg-primary/70" style={{ height: `${25 + Math.abs(Math.sin((t + i * 1.7) * 0.9)) * 75}%` }} />
            ))}
          </div>
        )}
      </div>
      <div className="absolute rounded-xl border border-primary/30 bg-primary/[0.07] p-[3%]" style={at(10, 54, 6)}>
        <div className="text-[clamp(7px,1.2vw,11px)] uppercase tracking-wider text-primary font-semibold mb-[4%]">Question 1 of 5</div>
        <div className="text-[clamp(8px,1.6vw,14px)] leading-snug min-h-[3em]">
          {typed('Tell me about a system you designed that had to scale. What broke first?', t, 1, 4)}
        </div>
      </div>
      <div className={`${button} ${recording ? 'bg-destructive text-white' : t >= 39 ? 'bg-secondary text-muted-foreground' : 'bg-primary text-primary-foreground'}`} style={at(80, 30, 30, 11)}>
        {t >= 39 ? <><Loader2 className="w-[1em] h-[1em] animate-spin" /> Analysing your answer…</> : recording ? 'Stop & submit' : <><Mic className="w-[1em] h-[1em]" /> Start answering</>}
      </div>
    </>
  )
}

function Report({ t }: { t: number }) {
  const score = Math.round(78 * clamp((t - 2) / 18, 0, 1))
  const bars: [string, number][] = [['Content', 82], ['Delivery', 74], ['Presence', 71]]
  const r = 40, c = 2 * Math.PI * r
  return (
    <>
      <div className="absolute flex flex-col items-center justify-center" style={{ ...at(12, 6, 56), bottom: '30%' }}>
        <svg viewBox="0 0 100 100" className="w-[70%] -rotate-90">
          <circle cx="50" cy="50" r={r} fill="none" stroke="currentColor" strokeWidth="8" className="text-foreground/10" />
          <circle cx="50" cy="50" r={r} fill="none" stroke="currentColor" strokeWidth="8" strokeLinecap="round" className="text-primary"
            strokeDasharray={c} strokeDashoffset={c * (1 - score / 100)} />
        </svg>
        <div className="absolute font-serif text-[clamp(14px,3.4vw,32px)]">{score}</div>
        <div className="mt-[4%] text-[clamp(7px,1.2vw,11px)] uppercase tracking-wider text-success font-semibold">{t >= 20 ? 'Recommend' : ' '}</div>
      </div>
      <div className="absolute space-y-[7%]" style={at(16, 48, 8)}>
        {bars.map(([name, value], i) => (
          <div key={name}>
            <div className="flex justify-between text-[clamp(8px,1.4vw,12px)] mb-[2%]"><span>{name}</span><span className="text-muted-foreground">{Math.round(value * clamp((t - 4 - i * 3) / 14, 0, 1))}</span></div>
            <div className="h-[0.5em] rounded-full bg-foreground/10" style={{ fontSize: 'clamp(8px,1.4vw,12px)' }}>
              <div className="h-full rounded-full bg-primary transition-[width] duration-300" style={{ width: `${value * clamp((t - 4 - i * 3) / 14, 0, 1)}%` }} />
            </div>
          </div>
        ))}
        {t >= 22 && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex flex-wrap gap-[3%] pt-[2%] text-[clamp(7px,1.2vw,11px)]">
            <span className="px-[4%] py-[1.5%] rounded-full bg-success/15 text-success border border-success/30">Clear structure</span>
            <span className="px-[4%] py-[1.5%] rounded-full bg-warning/15 text-warning border border-warning/30">Quantify impact</span>
          </motion.div>
        )}
      </div>
      <div className={`${button} border border-border ${t >= 36 ? 'bg-primary/15 text-primary border-primary/40' : 'bg-secondary'}`} style={at(80, 62, 8, 11)}>
        {t >= 38 ? <><Check className="w-[1em] h-[1em]" /> Saved PDF</> : <><FileDown className="w-[1em] h-[1em]" /> Download PDF</>}
      </div>
    </>
  )
}

const SCENES = [SignIn, Settings, JobAndResume, Answer, Report]

function Pointer({ x, y }: { x: number; y: number }) {
  return (
    <motion.div className="absolute z-20 pointer-events-none" animate={{ left: `${x}%`, top: `${y}%` }} transition={{ duration: 0.7, ease: [0.4, 0, 0.2, 1] }}>
      <svg width="22" height="22" viewBox="0 0 24 24" className="-translate-x-[3px] -translate-y-[2px] drop-shadow-[0_2px_6px_rgba(0,0,0,0.6)]">
        <path d="M4 2.5 19.5 12l-7 1.6L9 20.5z" fill="white" stroke="#0a0a0f" strokeWidth="1.4" strokeLinejoin="round" />
      </svg>
    </motion.div>
  )
}

export function ProductTour() {
  const reduce = useReducedMotion()
  const ref = useRef<HTMLDivElement>(null)
  const inView = useInView(ref, { amount: 0.35 })
  const [{ scene, t }, setState] = useState({ scene: 0, t: 0 })

  useEffect(() => {
    if (reduce || !inView) return
    const id = window.setInterval(() => {
      setState(s => (s.t + 1 >= SCENE_TICKS ? { scene: (s.scene + 1) % STEPS.length, t: 0 } : { ...s, t: s.t + 1 }))
    }, TICK_MS)
    return () => window.clearInterval(id)
  }, [reduce, inView])

  // With reduced motion, show each step's finished state and let the visitor click through.
  const shownT = reduce ? SCENE_TICKS : t
  const step = STEPS[scene]
  const Scene = SCENES[scene]
  const waypoint = [...step.cursor].reverse().find(w => w.at <= shownT) ?? step.cursor[0]
  const clicking = waypoint.click && shownT - waypoint.at >= 1 && shownT - waypoint.at < 5

  return (
    <div ref={ref} className="grid lg:grid-cols-[300px_1fr] gap-6 lg:gap-10 items-start">
      <ol className="hidden lg:block space-y-1">
        {STEPS.map((s, i) => (
          <li key={s.title}>
            <button type="button" onClick={() => setState({ scene: i, t: 0 })}
              className={`w-full text-left rounded-2xl px-4 py-3.5 transition border ${i === scene ? 'border-primary/40 bg-primary/[0.07]' : 'border-transparent hover:bg-secondary/40'}`}>
              <div className="flex items-center gap-3">
                <span className={`w-7 h-7 rounded-full text-xs font-semibold flex items-center justify-center shrink-0 ${i === scene ? 'bg-primary text-primary-foreground' : i < scene ? 'bg-success/20 text-success' : 'bg-secondary text-muted-foreground'}`}>
                  {i < scene ? <Check className="w-3.5 h-3.5" /> : i + 1}
                </span>
                <span className={`font-medium text-sm ${i === scene ? '' : 'text-muted-foreground'}`}>{s.title}</span>
              </div>
              {i === scene && (
                <>
                  <p className="mt-2 ml-10 text-xs text-muted-foreground leading-relaxed">{s.caption}</p>
                  {!reduce && (
                    <div className="mt-3 ml-10 h-0.5 rounded-full bg-foreground/10 overflow-hidden">
                      <div className="h-full bg-primary transition-[width] duration-100 ease-linear" style={{ width: `${(t / SCENE_TICKS) * 100}%` }} />
                    </div>
                  )}
                </>
              )}
            </button>
          </li>
        ))}
      </ol>

      <div>
        <div className="rounded-2xl border border-border bg-surface shadow-2xl shadow-black/40 overflow-hidden">
          <div className="flex items-center gap-2 px-4 h-10 border-b border-border bg-app/60">
            <span className="w-2.5 h-2.5 rounded-full bg-foreground/15" />
            <span className="w-2.5 h-2.5 rounded-full bg-foreground/15" />
            <span className="w-2.5 h-2.5 rounded-full bg-foreground/15" />
            <div className="ml-3 flex-1 max-w-xs rounded-md bg-secondary/60 px-3 py-1 text-[11px] text-muted-foreground font-mono truncate">tejaskrit{step.path}</div>
          </div>
          <div className="relative aspect-[16/10] select-none" aria-hidden="true">
            <AnimatePresence mode="wait">
              <motion.div key={scene} className="absolute inset-0" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.25 }}>
                <Scene t={shownT} />
              </motion.div>
            </AnimatePresence>
            {!reduce && (
              <>
                {clicking && (
                  <motion.span key={`${scene}-${waypoint.at}`} className="absolute z-10 w-8 h-8 -ml-4 -mt-4 rounded-full border-2 border-primary pointer-events-none"
                    style={{ left: `${waypoint.x}%`, top: `${waypoint.y}%` }}
                    initial={{ scale: 0.3, opacity: 0.9 }} animate={{ scale: 1.6, opacity: 0 }} transition={{ duration: 0.45 }} />
                )}
                <Pointer x={waypoint.x} y={waypoint.y} />
              </>
            )}
          </div>
        </div>

        {/* Small screens: caption + step dots under the stage instead of the side list. */}
        <div className="lg:hidden mt-4">
          <div className="text-sm font-medium"><span className="text-primary">{scene + 1}/{STEPS.length}</span> · {step.title}</div>
          <p className="mt-1 text-xs text-muted-foreground">{step.caption}</p>
          <div className="mt-3 flex gap-2">
            {STEPS.map((s, i) => (
              <button key={s.title} type="button" aria-label={`Step ${i + 1}: ${s.title}`} onClick={() => setState({ scene: i, t: 0 })}
                className={`h-1.5 rounded-full transition-all ${i === scene ? 'w-8 bg-primary' : 'w-4 bg-foreground/20'}`} />
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
