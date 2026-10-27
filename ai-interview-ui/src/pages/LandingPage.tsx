import { useEffect, useState } from 'react'
import { motion, useReducedMotion } from 'framer-motion'
import {
  Activity, ArrowRight, AudioLines, Brain, Check, ChevronDown, Eye, GitBranch,
  KeyRound, Lock, Mic, ScanFace, ShieldCheck, Sparkles, Timer, Waves,
} from 'lucide-react'
import { Logo } from '@/components/brand/Logo'
import { ProductTour } from '@/components/landing/ProductTour'
import { UserMenu } from '@/components/AppHeader'
import { useAuth } from '@/lib/auth'
import { Link } from '@/lib/router'

const fadeUp = {
  hidden: { opacity: 0, y: 24 },
  show: { opacity: 1, y: 0, transition: { duration: 0.7, ease: [0.2, 0.7, 0.2, 1] as const } },
}

function Section({ id, className = '', children }: { id?: string; className?: string; children: React.ReactNode }) {
  return (
    <motion.section
      id={id}
      initial="hidden"
      whileInView="show"
      viewport={{ once: true, margin: '-80px' }}
      variants={{ show: { transition: { staggerChildren: 0.08 } } }}
      className={`relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-10 ${className}`}
    >
      {children}
    </motion.section>
  )
}

function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <motion.div variants={fadeUp} className="text-[11px] uppercase tracking-[0.2em] text-primary font-semibold mb-4">
      {children}
    </motion.div>
  )
}

// ── Nav ────────────────────────────────────────────────────────────────────

function LandingNav() {
  const { user } = useAuth()
  const [scrolled, setScrolled] = useState(false)
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  return (
    <header
      className={`fixed top-0 inset-x-0 z-40 transition-all duration-300 ${
        scrolled ? 'bg-app/75 backdrop-blur-xl border-b border-border' : 'border-b border-transparent'
      }`}
    >
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-10 h-16 flex items-center gap-6">
        <Logo />
        <nav className="hidden md:flex items-center gap-1 text-sm text-muted-foreground">
          {[['#how', 'How it works'], ['#features', 'Features'], ['#privacy', 'Privacy'], ['#faq', 'FAQ']].map(([href, label]) => (
            <a key={href} href={href} className="px-3 py-1.5 rounded-lg hover:text-foreground transition">{label}</a>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-2">
          {user ? (
            <>
              <Link href="/app" className="hidden sm:inline-flex items-center gap-1.5 text-sm font-medium px-4 py-2 rounded-xl bg-primary text-primary-foreground hover:bg-primary/90 transition">
                Open app <ArrowRight className="w-3.5 h-3.5" />
              </Link>
              <UserMenu />
            </>
          ) : (
            <>
              <Link href="/login" className="text-sm text-muted-foreground hover:text-foreground px-3 py-2 transition">Sign in</Link>
              <Link href="/login" className="inline-flex items-center gap-1.5 text-sm font-medium px-4 py-2 rounded-xl bg-primary text-primary-foreground hover:bg-primary/90 transition glow-primary">
                Get started
              </Link>
            </>
          )}
        </div>
      </div>
    </header>
  )
}

// ── Hero visual: a stylised live interview ─────────────────────────────────

function Metric({ icon: Icon, label, value, tone = 'primary', className = '' }: {
  icon: typeof Eye; label: string; value: string; tone?: 'primary' | 'success' | 'warning'; className?: string
}) {
  const tones = {
    primary: 'text-primary bg-primary/15 border-primary/30',
    success: 'text-success bg-success/15 border-success/30',
    warning: 'text-warning bg-warning/15 border-warning/30',
  }
  return (
    <div className={`flex items-center gap-2.5 rounded-xl border border-border bg-surface/90 backdrop-blur px-3 py-2 shadow-xl ${className}`}>
      <div className={`w-7 h-7 rounded-lg border flex items-center justify-center ${tones[tone]}`}>
        <Icon className="w-3.5 h-3.5" />
      </div>
      <div className="leading-tight">
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
        <div className="text-sm font-semibold tabular-nums">{value}</div>
      </div>
    </div>
  )
}

function ScoreRing({ value }: { value: number }) {
  const r = 26
  const c = 2 * Math.PI * r
  return (
    <svg viewBox="0 0 64 64" className="w-16 h-16 -rotate-90">
      <circle cx="32" cy="32" r={r} stroke="var(--border)" strokeWidth="6" fill="none" />
      <motion.circle
        cx="32" cy="32" r={r} stroke="var(--success)" strokeWidth="6" fill="none" strokeLinecap="round"
        strokeDasharray={c}
        initial={{ strokeDashoffset: c }}
        animate={{ strokeDashoffset: c * (1 - value / 10) }}
        transition={{ duration: 1.6, delay: 0.8, ease: [0.2, 0.7, 0.2, 1] }}
      />
    </svg>
  )
}

function HeroVisual() {
  const reduce = useReducedMotion()
  const float = (d: number) => (reduce ? {} : { animate: { y: [0, -8, 0] }, transition: { duration: 6, repeat: Infinity, ease: 'easeInOut' as const, delay: d } })

  return (
    <div className="relative mx-auto w-full max-w-[560px] aspect-[4/5] sm:aspect-[5/4.4]">
      {/* glow */}
      <div className="absolute inset-8 rounded-[40px] bg-primary/25 blur-3xl" />

      {/* main card */}
      <motion.div
        initial={{ opacity: 0, y: 30, rotate: -1.5 }}
        animate={{ opacity: 1, y: 0, rotate: 0 }}
        transition={{ duration: 0.9, delay: 0.2, ease: [0.2, 0.7, 0.2, 1] }}
        className="absolute inset-x-4 top-6 bottom-10 rounded-[28px] border border-border bg-surface shadow-2xl overflow-hidden"
      >
        {/* title bar */}
        <div className="h-11 px-4 flex items-center gap-2 border-b border-border text-xs">
          <span className="w-2 h-2 rounded-full bg-destructive animate-blink" />
          <span className="font-medium">Recording</span>
          <span className="hidden sm:inline text-muted-foreground tabular-nums">01:24 / 02:00</span>
          <span className="ml-auto px-2 py-0.5 rounded-full bg-primary/15 text-primary border border-primary/30 font-medium">Q3 of 8 · System design</span>
        </div>

        {/* video area */}
        <div className="relative h-[calc(100%-44px)] bg-[radial-gradient(ellipse_at_50%_30%,oklch(0.26_0.05_285),oklch(0.14_0.02_280)_70%)]">
          <div className="absolute inset-0 grid-bg opacity-40" />
          {/* silhouette */}
          <svg viewBox="0 0 200 160" className="absolute left-1/2 -translate-x-1/2 bottom-0 w-[80%] sm:w-[58%]" aria-hidden>
            <defs>
              <linearGradient id="sil" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor="oklch(0.42 0.06 285)" />
                <stop offset="1" stopColor="oklch(0.2 0.03 280)" />
              </linearGradient>
            </defs>
            <ellipse cx="100" cy="62" rx="30" ry="36" fill="url(#sil)" />
            <path d="M30 160c4-38 34-56 70-56s66 18 70 56z" fill="url(#sil)" />
          </svg>
          {/* face tracking brackets */}
          <motion.div
            className="absolute left-1/2 top-[45%] -translate-x-1/2 w-[26%] sm:w-[22%] h-[32%]"
            animate={reduce ? undefined : { scale: [1, 1.03, 1] }}
            transition={{ duration: 3, repeat: Infinity }}
          >
            {['top-0 left-0 border-t-2 border-l-2 rounded-tl-lg', 'top-0 right-0 border-t-2 border-r-2 rounded-tr-lg',
              'bottom-0 left-0 border-b-2 border-l-2 rounded-bl-lg', 'bottom-0 right-0 border-b-2 border-r-2 rounded-br-lg'].map(c => (
              <span key={c} className={`absolute w-5 h-5 border-success ${c}`} />
            ))}
            <span className="absolute -bottom-7 left-1/2 -translate-x-1/2 whitespace-nowrap text-[10px] font-medium text-success bg-app/80 border border-success/30 rounded px-1.5 py-0.5">
              Face locked · gaze centered
            </span>
          </motion.div>

          {/* question bubble */}
          <div className="absolute left-4 right-4 top-4 sm:right-auto sm:max-w-[72%] rounded-2xl border border-border bg-app/80 backdrop-blur px-4 py-3">
            <div className="text-[10px] uppercase tracking-wider text-primary font-semibold mb-1">Interviewer</div>
            <div className="text-[13px] leading-snug">
              How would you design a real-time analytics pipeline that stays consistent under load?
            </div>
          </div>

          {/* waveform */}
          <div className="absolute right-4 bottom-4 hidden sm:flex items-end gap-[3px] h-8 rounded-xl bg-app/70 backdrop-blur px-3 py-1.5 border border-border">
            {Array.from({ length: 10 }).map((_, i) => (
              <span key={i} className="w-[3px] h-full rounded-full bg-primary animate-bar" style={{ animationDelay: `${(i % 6) * 0.12}s` }} />
            ))}
          </div>
        </div>
      </motion.div>

      {/* floating metrics */}
      <motion.div className="hidden sm:block absolute -left-8 top-[60%]" initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.6 }}>
        <motion.div {...float(0)}><Metric icon={Eye} label="Eye contact" value="91%" tone="success" /></motion.div>
      </motion.div>
      <motion.div className="hidden sm:block absolute -right-6 top-[38%]" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.75 }}>
        <motion.div {...float(1.2)}><Metric icon={Timer} label="Pace" value="142 wpm" /></motion.div>
      </motion.div>
      <motion.div className="hidden sm:block absolute -right-4 top-[56%]" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.9 }}>
        <motion.div {...float(2.1)}><Metric icon={AudioLines} label="Filler words" value="2" tone="warning" /></motion.div>
      </motion.div>

      {/* score card */}
      <motion.div
        initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 1 }}
        className="absolute left-6 sm:left-10 -bottom-1 flex items-center gap-3 rounded-2xl border border-border bg-surface/95 backdrop-blur pl-2 pr-5 py-2 shadow-2xl"
      >
        <div className="relative">
          <ScoreRing value={8.4} />
          <span className="absolute inset-0 flex items-center justify-center text-sm font-semibold">8.4</span>
        </div>
        <div className="leading-tight">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Answer score</div>
          <div className="text-sm font-semibold">Strong, specific, structured</div>
          <div className="text-[11px] text-success">+ concrete trade-offs named</div>
        </div>
      </motion.div>
    </div>
  )
}

// ── Content ────────────────────────────────────────────────────────────────

const PROVIDERS = ['Anthropic', 'OpenAI', 'Groq', 'Google Gemini', 'OpenRouter']

const FEATURES = [
  { icon: Brain, title: 'Questions written for this job', desc: 'Every question is generated from the JD and your resume — not pulled from a generic bank.', span: 'lg:col-span-2' },
  { icon: GitBranch, title: 'Adaptive follow-ups', desc: 'Vague answer? Expect a probing follow-up, just like a sharp interviewer.', span: '' },
  { icon: Mic, title: 'Delivery analysis', desc: 'Pace, pauses, filler words, hedging and confidence of language from your audio.', span: '' },
  { icon: ScanFace, title: 'Presence signals', desc: 'Eye contact, posture, gestures, expressions and fatigue — measured with MediaPipe face and pose tracking.', span: '' },
  { icon: Activity, title: 'Rubric-weighted scoring', desc: 'Technical depth, problem solving, clarity, confidence and culture fit, weighted the way the role demands.', span: '' },
  { icon: Waves, title: 'Works without a camera', desc: 'Webcam blocked or broken? The interview continues in audio-only mode instead of stopping.', span: 'lg:col-span-2' },
]

const FAQ = [
  { q: 'Why do I need my own API key?', a: 'You choose the model that evaluates you — and you pay your provider directly at their rates, with no markup. Keys are encrypted before they touch our database and are never sent back to your browser.' },
  { q: 'Which models can I use?', a: 'Any chat model your Anthropic, OpenAI, Groq, Gemini or OpenRouter key can access, for evaluation. Transcription can use Groq or OpenAI Whisper-family models, or an audio-capable Gemini / OpenRouter model. You can pick a separate cheaper model for quick routing decisions.' },
  { q: 'Do you store my recordings?', a: 'No. Each answer is processed in a temporary file that is deleted as soon as it has been analysed. Your finished report is kept for 24 hours so you can reopen it, then deleted; abandoned interviews are purged after 48 hours.' },
  { q: 'Is anything shared with employers?', a: 'No. This is a private practice tool. Your transcript is sent only to the AI provider you selected, under your own key.' },
  { q: 'How do I sign in?', a: 'With your email — we send a one-time 6-digit code. No passwords to remember or leak.' },
]

function FaqItem({ q, a }: { q: string; a: string }) {
  const [open, setOpen] = useState(false)
  return (
    <motion.div variants={fadeUp} className="border-b border-border">
      <button onClick={() => setOpen(o => !o)} className="w-full flex items-center justify-between gap-6 py-5 text-left" aria-expanded={open}>
        <span className="text-base font-medium">{q}</span>
        <ChevronDown className={`w-4 h-4 shrink-0 text-muted-foreground transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      <div className={`grid transition-all duration-300 ${open ? 'grid-rows-[1fr] opacity-100 pb-5' : 'grid-rows-[0fr] opacity-0'}`}>
        <p className="overflow-hidden text-sm text-muted-foreground leading-relaxed max-w-3xl">{a}</p>
      </div>
    </motion.div>
  )
}

function ReportPreview() {
  const rows = [
    ['Technical depth', 8.6, 35], ['Problem solving', 7.9, 25], ['Communication', 8.2, 20], ['Confidence', 7.1, 10], ['Culture fit', 8.8, 10],
  ] as const
  return (
    <div className="relative rounded-[28px] border border-border bg-surface p-6 sm:p-8 shadow-2xl">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Interview report</div>
          <div className="font-serif text-2xl mt-1">Senior Backend Engineer</div>
        </div>
        <div className="text-right">
          <div className="font-serif text-4xl leading-none">8.2</div>
          <div className="mt-1 inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full text-success bg-success/15 border border-success/30">
            <Check className="w-3 h-3" /> Hire
          </div>
        </div>
      </div>
      <div className="mt-6 space-y-3.5">
        {rows.map(([label, score, weight], i) => (
          <div key={label}>
            <div className="flex justify-between text-xs mb-1.5">
              <span>{label} <span className="text-muted-foreground">· {weight}%</span></span>
              <span className="tabular-nums font-medium">{score.toFixed(1)}</span>
            </div>
            <div className="h-1.5 rounded-full bg-secondary overflow-hidden">
              <motion.div
                className="h-full rounded-full bg-gradient-to-r from-primary to-[oklch(0.72_0.18_300)]"
                initial={{ width: 0 }} whileInView={{ width: `${score * 10}%` }} viewport={{ once: true }}
                transition={{ duration: 1.1, delay: 0.1 * i, ease: [0.2, 0.7, 0.2, 1] }}
              />
            </div>
          </div>
        ))}
      </div>
      <div className="mt-6 grid sm:grid-cols-2 gap-3 text-xs">
        <div className="rounded-xl border border-success/25 bg-success/5 p-3">
          <div className="font-semibold text-success mb-1">Strength</div>
          Named concrete trade-offs (Kafka vs. polling) and quantified impact.
        </div>
        <div className="rounded-xl border border-warning/25 bg-warning/5 p-3">
          <div className="font-semibold text-warning mb-1">To improve</div>
          Hedged on ownership — "I think we maybe" appeared 4 times.
        </div>
      </div>
    </div>
  )
}

// ── Page ───────────────────────────────────────────────────────────────────

export function LandingPage() {
  const { user } = useAuth()
  const ctaHref = user ? '/app' : '/login'

  return (
    <div className="min-h-screen bg-app text-foreground overflow-x-hidden">
      <LandingNav />

      {/* HERO */}
      <div className="relative">
        <div className="absolute inset-0 grid-bg opacity-60 pointer-events-none" />
        <div className="absolute -top-40 left-1/2 -translate-x-1/2 w-[900px] h-[600px] rounded-full bg-primary/20 blur-[120px] pointer-events-none" />
        <div className="absolute inset-0 noise-overlay pointer-events-none" />

        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-10 pt-32 sm:pt-36 pb-20 lg:pb-28 grid lg:grid-cols-[1.05fr_1fr] gap-14 lg:gap-10 items-center">
          <motion.div initial="hidden" animate="show" variants={{ show: { transition: { staggerChildren: 0.1 } } }}>
            <motion.div variants={fadeUp} className="inline-flex items-center gap-2 text-xs px-3 py-1.5 rounded-full border border-primary/30 bg-primary/10 text-primary font-medium mb-6">
              <Sparkles className="w-3.5 h-3.5" /> AI mock interviews · bring your own model
            </motion.div>
            <motion.h1 variants={fadeUp} className="font-serif text-[clamp(2.6rem,6.4vw,4.9rem)] leading-[1.02] tracking-tight">
              Rehearse the interview<br />
              <span className="gradient-text italic">before it counts.</span>
            </motion.h1>
            <motion.p variants={fadeUp} className="mt-6 text-lg text-muted-foreground leading-relaxed max-w-xl">
              An AI interviewer that reads the job description and your resume, asks the questions that role would ask,
              follows up when you're vague — then scores what you said, how you said it, and how you came across.
            </motion.p>
            <motion.div variants={fadeUp} className="mt-9 flex flex-wrap items-center gap-3">
              <Link
                href={ctaHref}
                className="group relative overflow-hidden inline-flex items-center gap-2 bg-primary text-primary-foreground font-medium px-6 py-3.5 rounded-xl glow-primary hover:bg-primary/90 transition"
              >
                <span className="absolute inset-0 bg-gradient-to-r from-transparent via-white/15 to-transparent -translate-x-full group-hover:translate-x-full transition-transform duration-700" />
                {user ? 'Start a practice interview' : 'Start practicing — free'}
                <ArrowRight className="w-4 h-4 group-hover:translate-x-0.5 transition-transform" />
              </Link>
              <a href="#how" className="inline-flex items-center gap-2 px-5 py-3.5 rounded-xl border border-border hover:border-primary/40 hover:bg-secondary/50 transition text-sm font-medium">
                See how it works
              </a>
            </motion.div>
            <motion.div variants={fadeUp} className="mt-8 flex flex-wrap gap-x-6 gap-y-2 text-sm text-muted-foreground">
              {['No password — email code sign-in', 'Recordings never stored', 'Your key, your model'].map(t => (
                <span key={t} className="inline-flex items-center gap-1.5"><Check className="w-3.5 h-3.5 text-success" /> {t}</span>
              ))}
            </motion.div>
          </motion.div>

          <HeroVisual />
        </div>
      </div>

      {/* PROVIDER STRIP */}
      <div className="relative border-y border-border bg-surface/40">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-10 py-7 flex flex-col md:flex-row md:items-center gap-4 md:gap-10">
          <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground shrink-0">Runs on your key from</div>
          <div className="relative flex-1 overflow-hidden [mask-image:linear-gradient(to_right,transparent,black_10%,black_90%,transparent)]">
            <div className="flex w-max gap-12 animate-marquee">
              {[...PROVIDERS, ...PROVIDERS, ...PROVIDERS, ...PROVIDERS].map((p, i) => (
                <span key={i} className="font-serif text-xl text-foreground/70 whitespace-nowrap">{p}</span>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* HOW IT WORKS */}
      <Section id="how" className="py-24 lg:py-32 scroll-mt-16">
        <div className="max-w-2xl">
          <Eyebrow>How it works</Eyebrow>
          <motion.h2 variants={fadeUp} className="font-serif text-[clamp(2rem,4vw,3.2rem)] leading-[1.08]">
            From sign-in to your report in five steps.
          </motion.h2>
          <motion.p variants={fadeUp} className="mt-4 text-muted-foreground leading-relaxed">
            Watch a full practice run — this is exactly what you'll click.
          </motion.p>
        </div>
        <motion.div variants={fadeUp} className="mt-12">
          <ProductTour />
        </motion.div>
      </Section>

      {/* FEATURES */}
      <Section id="features" className="pb-24 lg:pb-32 scroll-mt-16">
        <div className="grid lg:grid-cols-[1fr_1.1fr] gap-12 lg:gap-16 items-center">
          <div>
            <Eyebrow>The debrief</Eyebrow>
            <motion.h2 variants={fadeUp} className="font-serif text-[clamp(2rem,4vw,3.2rem)] leading-[1.08]">
              Feedback a real interviewer wouldn't have time to give you.
            </motion.h2>
            <motion.p variants={fadeUp} className="mt-5 text-muted-foreground leading-relaxed max-w-lg">
              Every answer is scored against a weighted rubric from three angles — the substance of what you said,
              your delivery, and your on-camera presence — then rolled into one clear recommendation.
            </motion.p>
            <motion.ul variants={fadeUp} className="mt-8 space-y-3 text-sm">
              {['Per-question scores with written justification', 'Strengths, weaknesses and red flags', 'Behavioural heatmap across the interview', 'One-click PDF export to keep or share'].map(t => (
                <li key={t} className="flex items-center gap-3">
                  <span className="w-5 h-5 rounded-full bg-success/15 border border-success/30 flex items-center justify-center"><Check className="w-3 h-3 text-success" /></span>
                  {t}
                </li>
              ))}
            </motion.ul>
          </div>
          <motion.div variants={fadeUp}><ReportPreview /></motion.div>
        </div>

        <div className="mt-20 grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {FEATURES.map(f => (
            <motion.div key={f.title} variants={fadeUp} className={`rounded-3xl border border-border bg-surface p-6 hover:border-primary/40 hover:-translate-y-0.5 transition ${f.span}`}>
              <f.icon className="w-5 h-5 text-primary mb-5" />
              <h3 className="font-medium mb-1.5">{f.title}</h3>
              <p className="text-sm text-muted-foreground leading-relaxed">{f.desc}</p>
            </motion.div>
          ))}
        </div>
      </Section>

      {/* PRIVACY / BYOK */}
      <Section id="privacy" className="pb-24 lg:pb-32 scroll-mt-16">
        <div className="relative overflow-hidden rounded-[36px] border border-border bg-gradient-to-br from-surface via-surface to-primary/10 p-8 sm:p-12 lg:p-16">
          <div className="absolute -right-24 -top-24 w-96 h-96 rounded-full bg-primary/15 blur-3xl" />
          <div className="relative grid lg:grid-cols-[1.1fr_1fr] gap-12 items-start">
            <div>
              <Eyebrow>Private by design</Eyebrow>
              <motion.h2 variants={fadeUp} className="font-serif text-[clamp(2rem,4vw,3rem)] leading-[1.08]">
                Your keys stay locked.<br />Your recordings don't stay at all.
              </motion.h2>
              <motion.p variants={fadeUp} className="mt-5 text-muted-foreground leading-relaxed max-w-lg">
                Bring a key from the provider you trust and choose separate models for evaluation and transcription.
                You pay your provider directly — we never mark up tokens.
              </motion.p>
            </div>
            <div className="grid sm:grid-cols-2 gap-4">
              {[
                { icon: KeyRound, t: 'Encrypted keys', d: 'Keys are encrypted at rest and never returned to the browser — only the last 4 characters are shown.' },
                { icon: Lock, t: 'Passwordless', d: 'One-time email codes, httpOnly session cookies, rate-limited sign-in.' },
                { icon: ShieldCheck, t: 'No recordings kept', d: 'Each answer is deleted from the server the moment it has been analysed.' },
                { icon: Eye, t: 'Never shared', d: 'Practice stays private. Delete your account and everything with it, any time.' },
              ].map(c => (
                <motion.div key={c.t} variants={fadeUp} className="rounded-2xl border border-border bg-app/60 backdrop-blur p-5">
                  <c.icon className="w-5 h-5 text-primary mb-3" />
                  <div className="font-medium text-sm mb-1">{c.t}</div>
                  <div className="text-xs text-muted-foreground leading-relaxed">{c.d}</div>
                </motion.div>
              ))}
            </div>
          </div>
        </div>
      </Section>

      {/* FAQ */}
      <Section id="faq" className="pb-24 lg:pb-32 scroll-mt-16">
        <div className="grid lg:grid-cols-[1fr_2fr] gap-10">
          <div>
            <Eyebrow>FAQ</Eyebrow>
            <motion.h2 variants={fadeUp} className="font-serif text-[clamp(2rem,4vw,3rem)] leading-[1.08]">Questions, answered.</motion.h2>
          </div>
          <div className="border-t border-border">
            {FAQ.map(f => <FaqItem key={f.q} {...f} />)}
          </div>
        </div>
      </Section>

      {/* FINAL CTA */}
      <Section className="pb-24">
        <motion.div variants={fadeUp} className="relative overflow-hidden rounded-[36px] border border-primary/30 bg-gradient-to-b from-primary/20 to-surface px-6 py-16 sm:py-20 text-center">
          <div className="absolute inset-0 grid-bg opacity-40" />
          <div className="relative">
            <h2 className="font-serif text-[clamp(2.2rem,5vw,3.8rem)] leading-[1.05]">Walk in having already<br className="hidden sm:block" /> done it once.</h2>
            <p className="mt-5 text-muted-foreground max-w-lg mx-auto">Set up takes about two minutes. Your first interview starts as soon as you add a key.</p>
            <Link href={ctaHref} className="mt-9 inline-flex items-center gap-2 bg-primary text-primary-foreground font-medium px-7 py-4 rounded-xl glow-primary hover:bg-primary/90 transition">
              {user ? 'Open the app' : 'Create your free account'} <ArrowRight className="w-4 h-4" />
            </Link>
          </div>
        </motion.div>
      </Section>

      <footer className="border-t border-border">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-10 py-10 flex flex-col sm:flex-row items-center justify-between gap-4 text-sm text-muted-foreground">
          <Logo size="sm" />
          <div>Practice results are for self-improvement only and are not shared with employers.</div>
          <div>© {new Date().getFullYear()} tejaskrit</div>
        </div>
      </footer>
    </div>
  )
}
