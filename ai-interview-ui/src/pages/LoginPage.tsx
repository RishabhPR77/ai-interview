import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { ArrowLeft, ArrowRight, Check, Loader2, Mail, ShieldCheck } from 'lucide-react'
import { Logo } from '@/components/brand/Logo'
import { ApiError } from '@/lib/api'
import { getAiSettings, requestOtp, updateProfile, verifyOtp } from '@/lib/account-api'
import { useAuth } from '@/lib/auth'
import { navigate } from '@/lib/router'

type Step = 'email' | 'code' | 'name'

const inputCls =
  'w-full bg-input/60 border border-border rounded-xl px-4 py-3.5 text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:border-primary/60 focus:bg-input focus:ring-4 focus:ring-primary/15 transition'

async function goAfterLogin() {
  const next = new URLSearchParams(window.location.search).get('next')
  if (next && next.startsWith('/') && !next.startsWith('//')) return navigate(next, { replace: true })
  try {
    const s = await getAiSettings()
    navigate(s.ready ? '/app' : '/settings?onboarding=1', { replace: true })
  } catch {
    navigate('/app', { replace: true })
  }
}

function CodeInput({ onChange, disabled }: { onChange: (v: string) => void; disabled?: boolean }) {
  const refs = useRef<(HTMLInputElement | null)[]>([])
  // The ref is the source of truth so fast typing / autofill never reads a
  // stale render; state only drives what's displayed. Remount (key) to reset.
  const digitsRef = useRef<string[]>(Array(6).fill(''))
  const [digits, setDigits] = useState<string[]>(() => Array(6).fill(''))

  useEffect(() => { refs.current[0]?.focus() }, [])

  function commit(next: string[]) {
    digitsRef.current = next
    setDigits(next)
    onChange(next.join(''))
  }
  function fill(from: number, text: string) {
    const chars = text.replace(/\D/g, '').slice(0, 6 - from).split('')
    if (!chars.length) return
    const next = digitsRef.current.slice()
    chars.forEach((c, k) => { next[from + k] = c })
    commit(next)
    refs.current[Math.min(from + chars.length, 5)]?.focus()
  }
  function clear(i: number) {
    const next = digitsRef.current.slice()
    next[i] = ''
    commit(next)
  }
  function onKey(i: number, e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Backspace') {
      e.preventDefault()
      if (digitsRef.current[i]) clear(i)
      else if (i > 0) { clear(i - 1); refs.current[i - 1]?.focus() }
    } else if (e.key === 'ArrowLeft' && i > 0) refs.current[i - 1]?.focus()
    else if (e.key === 'ArrowRight' && i < 5) refs.current[i + 1]?.focus()
  }

  return (
    <div className="flex gap-2 sm:gap-3 justify-between" role="group" aria-label="6-digit code">
      {digits.map((d, i) => (
        <input
          key={i}
          ref={el => { refs.current[i] = el }}
          value={d}
          disabled={disabled}
          inputMode="numeric"
          autoComplete={i === 0 ? 'one-time-code' : 'off'}
          aria-label={`Digit ${i + 1}`}
          onPaste={e => { e.preventDefault(); fill(i, e.clipboardData.getData('text')) }}
          onKeyDown={e => onKey(i, e)}
          onFocus={e => e.target.select()}
          onChange={e => fill(i, e.target.value.replace(d, '') || e.target.value)}
          className={`w-full aspect-[4/5] max-w-14 text-center text-2xl font-semibold tabular-nums rounded-xl border bg-input/60 focus:outline-none focus:border-primary/60 focus:ring-4 focus:ring-primary/15 transition disabled:opacity-60 ${
            d ? 'border-primary/50' : 'border-border'
          }`}
        />
      ))}
    </div>
  )
}

export function LoginPage() {
  const { user, setUser } = useAuth()
  const [step, setStep] = useState<Step>('email')
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [cooldown, setCooldown] = useState(0)
  const [codeKey, setCodeKey] = useState(0)

  // Already signed in (e.g. opened /login in a second tab)
  useEffect(() => {
    if (user && step === 'email') goAfterLogin()
  }, [user, step])

  useEffect(() => {
    if (cooldown <= 0) return
    const t = setTimeout(() => setCooldown(c => c - 1), 1000)
    return () => clearTimeout(t)
  }, [cooldown])

  async function sendCode(e?: FormEvent) {
    e?.preventDefault()
    setError(null)
    setBusy(true)
    try {
      const res = await requestOtp(email.trim())
      setCooldown(res.resend_after_seconds)
      setCode('')
      setCodeKey(k => k + 1)
      setStep('code')
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  async function submitCode(value = code) {
    if (value.length !== 6 || busy) return
    setError(null)
    setBusy(true)
    try {
      const res = await verifyOtp(email.trim(), value)
      if (!res.user.name) {
        // The user isn't put into context until the profile is complete, so the
        // "already signed in" redirect doesn't skip this step.
        setStep('name')
      } else {
        setUser(res.user)
        await goAfterLogin()
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong. Please try again.')
      setCode('')
      setCodeKey(k => k + 1)
    } finally {
      setBusy(false)
    }
  }

  async function saveName(e: FormEvent) {
    e.preventDefault()
    if (!name.trim()) return
    setBusy(true)
    setError(null)
    try {
      const res = await updateProfile(name.trim())
      setUser(res.user)
      await goAfterLogin()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save your name.')
    } finally {
      setBusy(false)
    }
  }

  const panel = {
    initial: { opacity: 0, x: 24 },
    animate: { opacity: 1, x: 0, transition: { duration: 0.35 } },
    exit: { opacity: 0, x: -24, transition: { duration: 0.2 } },
  }

  return (
    <div className="min-h-screen bg-app text-foreground grid lg:grid-cols-[1fr_1.1fr]">
      {/* Brand panel */}
      <aside className="relative hidden lg:flex flex-col justify-between overflow-hidden border-r border-border bg-surface p-12">
        <div className="absolute inset-0 grid-bg opacity-50" />
        <div className="absolute -bottom-40 -left-40 w-[560px] h-[560px] rounded-full bg-primary/25 blur-[120px]" />
        <div className="relative"><Logo /></div>
        <div className="relative max-w-md">
          <div className="font-serif text-[2.6rem] leading-[1.1]">
            The best time to bomb an interview is <span className="gradient-text italic">in practice.</span>
          </div>
          <ul className="mt-10 space-y-4 text-sm text-muted-foreground">
            {['Questions tailored to the exact job description', 'Scored on content, delivery and presence', 'Your own AI key — encrypted, never shown again'].map(t => (
              <li key={t} className="flex items-center gap-3">
                <span className="w-6 h-6 rounded-full bg-primary/15 border border-primary/30 flex items-center justify-center"><Check className="w-3.5 h-3.5 text-primary" /></span>
                {t}
              </li>
            ))}
          </ul>
        </div>
        <div className="relative flex items-center gap-2 text-xs text-muted-foreground">
          <ShieldCheck className="w-3.5 h-3.5" /> Passwordless sign-in · codes expire in 10 minutes
        </div>
      </aside>

      {/* Form */}
      <main className="relative flex flex-col px-4 sm:px-6 py-8">
        <div className="lg:hidden"><Logo /></div>
        <div className="flex-1 flex items-center justify-center">
          <div className="w-full max-w-sm">
            <AnimatePresence mode="wait">
              {step === 'email' && (
                <motion.form key="email" {...panel} onSubmit={sendCode}>
                  <h1 className="font-serif text-4xl leading-tight">Sign in or sign up</h1>
                  <p className="mt-3 text-muted-foreground">Enter your email and we'll send you a 6-digit code. No password needed.</p>
                  <label htmlFor="email" className="block text-xs uppercase tracking-wider text-muted-foreground font-medium mt-9 mb-2">Email</label>
                  <div className="relative">
                    <Mail className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                    <input
                      id="email"
                      type="email"
                      required
                      autoFocus
                      autoComplete="email"
                      value={email}
                      onChange={e => setEmail(e.target.value)}
                      placeholder="you@example.com"
                      className={`${inputCls} pl-11`}
                    />
                  </div>
                  {error && <p role="alert" className="mt-3 text-sm text-destructive">{error}</p>}
                  <button
                    type="submit"
                    disabled={busy || !email.trim()}
                    className="mt-6 w-full inline-flex items-center justify-center gap-2 bg-primary text-primary-foreground font-medium px-6 py-3.5 rounded-xl glow-primary hover:bg-primary/90 disabled:opacity-60 disabled:cursor-not-allowed transition"
                  >
                    {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <>Send code <ArrowRight className="w-4 h-4" /></>}
                  </button>
                  <p className="mt-6 text-xs text-muted-foreground leading-relaxed">
                    New here? Signing in creates your account. We only use your email to send sign-in codes.
                  </p>
                </motion.form>
              )}

              {step === 'code' && (
                <motion.div key="code" {...panel}>
                  <button onClick={() => { setStep('email'); setError(null) }} className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition mb-8">
                    <ArrowLeft className="w-4 h-4" /> Change email
                  </button>
                  <h1 className="font-serif text-4xl leading-tight">Check your inbox</h1>
                  <p className="mt-3 text-muted-foreground">
                    We sent a code to <span className="text-foreground font-medium break-all">{email}</span>.
                  </p>
                  <div className="mt-9">
                    <CodeInput key={codeKey} disabled={busy} onChange={v => { setCode(v); if (v.length === 6) submitCode(v) }} />
                  </div>
                  {error && <p role="alert" className="mt-4 text-sm text-destructive">{error}</p>}
                  <button
                    onClick={() => submitCode()}
                    disabled={busy || code.length !== 6}
                    className="mt-6 w-full inline-flex items-center justify-center gap-2 bg-primary text-primary-foreground font-medium px-6 py-3.5 rounded-xl glow-primary hover:bg-primary/90 disabled:opacity-60 disabled:cursor-not-allowed transition"
                  >
                    {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Verify & continue'}
                  </button>
                  <div className="mt-6 text-sm text-muted-foreground text-center">
                    Didn't get it? Check spam, or{' '}
                    {cooldown > 0 ? (
                      <span className="tabular-nums">resend in {cooldown}s</span>
                    ) : (
                      <button onClick={() => sendCode()} disabled={busy} className="text-primary hover:underline">resend the code</button>
                    )}
                  </div>
                </motion.div>
              )}

              {step === 'name' && (
                <motion.form key="name" {...panel} onSubmit={saveName}>
                  <div className="w-12 h-12 rounded-2xl bg-success/15 border border-success/30 flex items-center justify-center mb-8">
                    <Check className="w-6 h-6 text-success" />
                  </div>
                  <h1 className="font-serif text-4xl leading-tight">You're in. What should we call you?</h1>
                  <p className="mt-3 text-muted-foreground">Your interviewer will greet you by this name.</p>
                  <label htmlFor="name" className="block text-xs uppercase tracking-wider text-muted-foreground font-medium mt-9 mb-2">Full name</label>
                  <input
                    id="name"
                    autoFocus
                    required
                    maxLength={120}
                    autoComplete="name"
                    value={name}
                    onChange={e => setName(e.target.value)}
                    placeholder="e.g. Alex Morgan"
                    className={inputCls}
                  />
                  {error && <p role="alert" className="mt-3 text-sm text-destructive">{error}</p>}
                  <button
                    type="submit"
                    disabled={busy || !name.trim()}
                    className="mt-6 w-full inline-flex items-center justify-center gap-2 bg-primary text-primary-foreground font-medium px-6 py-3.5 rounded-xl glow-primary hover:bg-primary/90 disabled:opacity-60 disabled:cursor-not-allowed transition"
                  >
                    {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <>Continue <ArrowRight className="w-4 h-4" /></>}
                  </button>
                </motion.form>
              )}
            </AnimatePresence>
          </div>
        </div>
      </main>
    </div>
  )
}
