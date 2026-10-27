import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import {
  AlertTriangle, ArrowRight, AudioLines, Brain, CheckCircle2, ExternalLink, Eye, EyeOff, KeyRound,
  Loader2, Lock, PlayCircle, RefreshCw, Sparkles, Trash2, User as UserIcon, Zap,
} from 'lucide-react'
import { toast, Toaster } from 'sonner'
import { AppHeader } from '@/components/AppHeader'
import { ModelSelect, type SelectOption } from '@/components/ModelSelect'
import { ApiError } from '@/lib/api'
import {
  deleteAccount, getAiSettings, listProviderModels, removeProviderKey, saveAiSelection, saveProviderKey,
  updateProfile,
  type AiSelection, type AiSettings, type ModelOption, type ProviderId, type ProviderInfo,
} from '@/lib/account-api'
import { useAuth } from '@/lib/auth'
import { Link, navigate, useLocation } from '@/lib/router'

const inputCls =
  'w-full bg-input/60 border border-border rounded-xl px-3.5 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:border-primary/60 focus:bg-input focus:ring-4 focus:ring-primary/15 transition disabled:opacity-60'
const btnPrimary =
  'inline-flex items-center justify-center gap-2 bg-primary text-primary-foreground text-sm font-medium px-4 py-2.5 rounded-xl hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition'
const btnGhost =
  'inline-flex items-center justify-center gap-2 border border-border text-sm px-3.5 py-2.5 rounded-xl hover:bg-secondary disabled:opacity-50 transition'

const errMsg = (e: unknown) => (e instanceof ApiError ? e.message : 'Something went wrong')

function Card({ title, desc, icon: Icon, children, id }: {
  title: string; desc?: string; icon: typeof Brain; children: React.ReactNode; id?: string
}) {
  return (
    <section id={id} className="rounded-3xl border border-border bg-surface p-5 sm:p-7 scroll-mt-20">
      <div className="flex items-start gap-3 mb-6">
        <div className="w-9 h-9 rounded-xl bg-primary/15 border border-primary/30 flex items-center justify-center shrink-0">
          <Icon className="w-4 h-4 text-primary" />
        </div>
        <div>
          <h2 className="font-serif text-xl leading-tight">{title}</h2>
          {desc && <p className="text-sm text-muted-foreground mt-1 leading-relaxed">{desc}</p>}
        </div>
      </div>
      {children}
    </section>
  )
}

// ── Profile ────────────────────────────────────────────────────────────────

function ProfileCard() {
  const { user, setUser } = useAuth()
  const [name, setName] = useState(user?.name ?? '')
  const [busy, setBusy] = useState(false)
  if (!user) return null

  async function save(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    try {
      const res = await updateProfile(name.trim())
      setUser(res.user)
      toast.success('Profile saved')
    } catch (err) {
      toast.error(errMsg(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card title="Profile" icon={UserIcon}>
      <form onSubmit={save} className="grid sm:grid-cols-[1fr_1fr_auto] gap-3 items-end">
        <div>
          <label className="block text-xs uppercase tracking-wider text-muted-foreground font-medium mb-2">Name</label>
          <input value={name} onChange={e => setName(e.target.value)} maxLength={120} required className={inputCls} />
        </div>
        <div>
          <label className="block text-xs uppercase tracking-wider text-muted-foreground font-medium mb-2">Email</label>
          <input value={user.email} disabled className={inputCls} />
        </div>
        <button type="submit" disabled={busy || !name.trim() || name.trim() === user.name} className={btnPrimary}>
          {busy && <Loader2 className="w-4 h-4 animate-spin" />} Save
        </button>
      </form>
    </Card>
  )
}

// ── Provider keys ──────────────────────────────────────────────────────────

function ProviderCard({ p, onChange }: { p: ProviderInfo; onChange: (s: AiSettings) => void }) {
  const [editing, setEditing] = useState(!p.connected)
  const [key, setKey] = useState('')
  const [show, setShow] = useState(false)
  const [busy, setBusy] = useState<'save' | 'remove' | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function save(e: FormEvent) {
    e.preventDefault()
    setBusy('save')
    setError(null)
    try {
      const s = await saveProviderKey(p.id, key.trim())
      setKey('')
      setShow(false)
      onChange(s)
      toast.success(`${p.label} connected`)
    } catch (err) {
      setError(errMsg(err))
    } finally {
      setBusy(null)
    }
  }

  async function remove() {
    if (!window.confirm(`Remove your ${p.label} key? Models using it will be unselected.`)) return
    setBusy('remove')
    try {
      onChange(await removeProviderKey(p.id))
      toast.success(`${p.label} key removed`)
    } catch (err) {
      toast.error(errMsg(err))
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className={`rounded-2xl border p-4 sm:p-5 transition ${p.connected ? 'border-success/30 bg-success/[0.04]' : 'border-border bg-app/40'}`}>
      <div className="flex items-center gap-3 flex-wrap">
        <div className="font-medium">{p.label}</div>
        {p.connected ? (
          <span className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full text-success bg-success/15 border border-success/30">
            <CheckCircle2 className="w-3 h-3" /> Connected <span className="font-mono opacity-80">{p.key_hint}</span>
          </span>
        ) : (
          <span className="text-[11px] px-2 py-0.5 rounded-full text-muted-foreground border border-border">Not connected</span>
        )}
        <span className="text-[11px] text-muted-foreground">{p.supports_stt ? 'LLM + transcription' : 'LLM'}</span>
        <a href={p.key_url} target="_blank" rel="noreferrer noopener" className="ml-auto inline-flex items-center gap-1 text-xs text-primary hover:underline">
          Get a key <ExternalLink className="w-3 h-3" />
        </a>
      </div>

      {editing ? (
        <form onSubmit={save} className="mt-4 flex flex-col sm:flex-row gap-2">
          <div className="relative flex-1">
            <input
              type={show ? 'text' : 'password'}
              value={key}
              onChange={e => setKey(e.target.value)}
              placeholder={`Paste your ${p.label} API key`}
              autoComplete="off"
              spellCheck={false}
              className={`${inputCls} pr-10 font-mono`}
            />
            <button type="button" onClick={() => setShow(s => !s)} aria-label={show ? 'Hide key' : 'Show key'}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
              {show ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
          <div className="flex gap-2">
            <button type="submit" disabled={!!busy || key.trim().length < 8} className={btnPrimary}>
              {busy === 'save' ? <><Loader2 className="w-4 h-4 animate-spin" /> Verifying…</> : 'Verify & save'}
            </button>
            {p.connected && <button type="button" onClick={() => { setEditing(false); setKey(''); setError(null) }} className={btnGhost}>Cancel</button>}
          </div>
        </form>
      ) : (
        <div className="mt-4 flex gap-2">
          <button onClick={() => setEditing(true)} className={btnGhost}><RefreshCw className="w-3.5 h-3.5" /> Replace key</button>
          <button onClick={remove} disabled={!!busy} className={`${btnGhost} text-destructive hover:bg-destructive/10 hover:border-destructive/40`}>
            {busy === 'remove' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />} Remove
          </button>
        </div>
      )}
      {error && <p role="alert" className="mt-3 text-sm text-destructive">{error}</p>}
    </div>
  )
}

// ── Model pickers ──────────────────────────────────────────────────────────

type ModelLists = Partial<Record<ProviderId, { llm: ModelOption[]; stt: ModelOption[] } | { error: string } | 'loading'>>

function ModelPicker({
  label, hint, icon: Icon, kind, providers, provider, model, lists, onLoad, onChange,
}: {
  label: string; hint: string; icon: typeof Brain; kind: 'llm' | 'fast' | 'stt'
  providers: ProviderInfo[]; provider: ProviderId | null; model: string | null
  lists: ModelLists; onLoad: (p: ProviderId) => void
  onChange: (p: ProviderId | null, m: string | null) => void
}) {
  const usable = providers.filter(p => p.connected && (kind !== 'stt' || p.supports_stt))
  const current = providers.find(p => p.id === provider)
  const list = provider ? (lists[provider] ?? 'loading') : undefined

  useEffect(() => { if (provider) onLoad(provider) }, [provider, onLoad])

  const loaded = list && typeof list === 'object' && !('error' in list) ? list : null
  const options = useMemo<SelectOption[]>(() => {
    if (!current || !loaded) return []
    const suggested = kind === 'stt' ? current.suggested_stt : kind === 'fast' ? [current.suggested_fast, ...current.suggested_llm] : current.suggested_llm
    const live = kind === 'stt' ? loaded.stt : loaded.llm
    // Suggestions the key can actually use first, then everything else it can see.
    const byId = new Map(live.map(m => [m.id, m]))
    const recommended = Array.from(new Set(suggested)).flatMap(id => {
      const m = byId.get(id)
      return m ? [{ ...m, recommended: true }] : []
    })
    const rest = live.filter(m => !recommended.some(r => r.id === m.id))
    const all: SelectOption[] = [...recommended, ...rest]
    // Keep a saved model visible even if the provider stopped listing it.
    if (model && !byId.has(model)) all.unshift({ id: model, name: model, detail: 'current choice · not in your key’s list' })
    return all
  }, [current, loaded, kind, model])

  function pickProvider(id: string) {
    if (!id) return onChange(null, null)
    const p = providers.find(x => x.id === id)!
    const first = kind === 'stt' ? p.suggested_stt[0] : kind === 'fast' ? p.suggested_fast : p.suggested_llm[0]
    onChange(p.id, first ?? '')
  }

  return (
    <div className="rounded-2xl border border-border bg-app/40 p-4 sm:p-5">
      <div className="flex items-start gap-3 mb-4">
        <Icon className="w-4 h-4 text-primary mt-0.5" />
        <div>
          <div className="font-medium text-sm">{label}</div>
          <div className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{hint}</div>
        </div>
      </div>
      {usable.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {kind === 'stt'
            ? 'Connect Groq, OpenAI, Gemini or OpenRouter to choose a transcription model.'
            : 'Connect a provider above to choose a model.'}
        </p>
      ) : (
        <div className="grid sm:grid-cols-[180px_1fr] gap-2 items-start">
          <select value={provider ?? ''} onChange={e => pickProvider(e.target.value)} className={inputCls} aria-label={`${label} provider`}>
            <option value="">Select provider…</option>
            {usable.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
          </select>
          <div>
            {list && typeof list === 'object' && 'error' in list ? (
              // Only when the provider's model list can't be fetched: fall back to typing an ID.
              <input
                value={model ?? ''}
                onChange={e => onChange(provider, e.target.value)}
                placeholder="Model ID"
                spellCheck={false}
                aria-label={`${label} model`}
                className={`${inputCls} font-mono`}
              />
            ) : (
              <ModelSelect
                options={options}
                value={model}
                onChange={m => onChange(provider, m)}
                disabled={!provider || !loaded}
                placeholder={!provider ? 'Choose a provider first' : !loaded ? 'Loading models…' : 'Choose a model'}
                label={`${label} model`}
              />
            )}
            <div className="mt-1.5 text-[11px] text-muted-foreground min-h-4">
              {list === 'loading' && <span className="inline-flex items-center gap-1"><Loader2 className="w-3 h-3 animate-spin" /> Loading the models your key can use…</span>}
              {list && typeof list === 'object' && 'error' in list && <span className="text-warning">Couldn't load the model list ({list.error}). Type a model ID instead.</span>}
              {loaded && (
                options.length === 0
                  ? <span className="text-warning">Your key can't use any {kind === 'stt' ? 'transcription' : 'chat'} models from this provider.</span>
                  : <span>{options.length} models your key can use{options.some(o => o.recommended) && <> · <Sparkles className="inline w-3 h-3 text-primary -mt-0.5" /> recommended</>}</span>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function ModelsCard({ settings, onChange }: { settings: AiSettings; onChange: (s: AiSettings) => void }) {
  // The parent remounts this card (key) whenever saved settings or keys change,
  // so the draft and model lists always start from fresh server state.
  const [draft, setDraft] = useState<AiSelection>(settings.selection)
  const [sameFast, setSameFast] = useState(!settings.selection.fast_provider)
  const [lists, setLists] = useState<ModelLists>({})
  const [busy, setBusy] = useState(false)
  const requested = useRef(new Set<ProviderId>())

  const load = useCallback((p: ProviderId) => {
    if (requested.current.has(p)) return
    requested.current.add(p)
    listProviderModels(p)
      .then(r => setLists(l => ({ ...l, [p]: { llm: r.llm, stt: r.stt } })))
      .catch(e => setLists(l => ({ ...l, [p]: { error: errMsg(e) } })))
  }, [])

  const effective: AiSelection = sameFast ? { ...draft, fast_provider: null, fast_model: null } : draft
  const dirty = JSON.stringify(effective) !== JSON.stringify(settings.selection)
  const valid = [['eval', effective.eval_provider, effective.eval_model], ['fast', effective.fast_provider, effective.fast_model], ['stt', effective.stt_provider, effective.stt_model]]
    .every(([, p, m]) => !p || (m && String(m).trim()))

  async function save() {
    setBusy(true)
    try {
      const saved = await saveAiSelection(effective)
      onChange(saved)
      toast.success(saved.ready ? 'Saved — you’re ready to start an interview' : 'Model choices saved')
    } catch (err) {
      toast.error(errMsg(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card id="models" title="Models" icon={Brain} desc="Pick which model evaluates you and which one transcribes your answers. They can come from different providers.">
      <div className="space-y-3">
        <ModelPicker
          label="Evaluation model" kind="llm" icon={Brain}
          hint="Writes your questions, scores every answer and produces the final report. Use your strongest model."
          providers={settings.providers} provider={draft.eval_provider} model={draft.eval_model}
          lists={lists} onLoad={load}
          onChange={(p, m) => setDraft(d => ({ ...d, eval_provider: p, eval_model: m }))}
        />
        <div className="rounded-2xl border border-border bg-app/40 p-4 sm:p-5">
          <label className="flex items-start gap-3 cursor-pointer">
            <input type="checkbox" checked={sameFast} onChange={e => {
              setSameFast(e.target.checked)
              if (!e.target.checked && !draft.fast_provider && draft.eval_provider) {
                const p = settings.providers.find(x => x.id === draft.eval_provider)
                setDraft(d => ({ ...d, fast_provider: d.eval_provider, fast_model: p?.suggested_fast ?? d.eval_model }))
              }
            }} className="mt-1 accent-[var(--primary)]" />
            <div>
              <div className="font-medium text-sm flex items-center gap-1.5"><Zap className="w-3.5 h-3.5 text-primary" /> Use the evaluation model for quick decisions</div>
              <div className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
                Choosing the next question, follow-ups and seniority detection are simple calls. Untick to use a cheaper, faster model for them.
              </div>
            </div>
          </label>
          {!sameFast && (
            <div className="mt-4">
              <ModelPicker
                label="Fast model" kind="fast" icon={Zap}
                hint="Used for routing decisions and follow-up questions."
                providers={settings.providers} provider={draft.fast_provider} model={draft.fast_model}
                lists={lists} onLoad={load}
                onChange={(p, m) => setDraft(d => ({ ...d, fast_provider: p, fast_model: m }))}
              />
            </div>
          )}
        </div>
        <ModelPicker
          label="Transcription model" kind="stt" icon={AudioLines}
          hint="Turns each recorded answer into text. Whisper-family models (Groq, OpenAI) are fastest; Gemini and audio-capable OpenRouter models also work."
          providers={settings.providers} provider={draft.stt_provider} model={draft.stt_model}
          lists={lists} onLoad={load}
          onChange={(p, m) => setDraft(d => ({ ...d, stt_provider: p, stt_model: m }))}
        />
      </div>
      {settings.ready && !dirty ? (
        // Setup is complete and saved: the only thing left to do is start.
        <div className="mt-5 rounded-2xl border border-success/30 bg-success/[0.06] p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center gap-4">
          <CheckCircle2 className="w-6 h-6 text-success shrink-0" />
          <div className="flex-1">
            <div className="font-medium">You’re all set.</div>
            <div className="text-sm text-muted-foreground">Your key and models are saved. Next: paste a job description and your resume, then answer on camera.</div>
          </div>
          <Link href="/app" className={`${btnPrimary} px-5 py-3 text-base glow-primary`}>
            <PlayCircle className="w-5 h-5" /> Start interview
          </Link>
        </div>
      ) : (
        <div className="mt-5 flex items-center justify-end gap-3">
          {dirty && <span className="text-xs text-muted-foreground">Unsaved changes — save to continue</span>}
          <button onClick={save} disabled={!dirty || !valid || busy} className={btnPrimary}>
            {busy && <Loader2 className="w-4 h-4 animate-spin" />} Save models
          </button>
        </div>
      )}
    </Card>
  )
}

// ── Danger zone ────────────────────────────────────────────────────────────

function DangerZone() {
  const { setUser } = useAuth()
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  async function remove() {
    setBusy(true)
    try {
      await deleteAccount()
      setUser(null)
      navigate('/', { replace: true })
    } catch (err) {
      toast.error(errMsg(err))
      setBusy(false)
    }
  }
  return (
    <section className="rounded-3xl border border-destructive/30 bg-destructive/[0.04] p-5 sm:p-7">
      <div className="flex items-start gap-3">
        <AlertTriangle className="w-5 h-5 text-destructive shrink-0 mt-0.5" />
        <div className="flex-1">
          <h2 className="font-serif text-xl">Delete account</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Permanently deletes your account, saved API keys, model choices, saved reports and any interview in progress. This can't be undone.
          </p>
          <div className="mt-4 flex flex-col sm:flex-row gap-2">
            <input value={confirm} onChange={e => setConfirm(e.target.value)} placeholder='Type "delete" to confirm' className={`${inputCls} sm:max-w-xs`} />
            <button onClick={remove} disabled={confirm.trim().toLowerCase() !== 'delete' || busy}
              className="inline-flex items-center justify-center gap-2 bg-destructive text-destructive-foreground text-sm font-medium px-4 py-2.5 rounded-xl hover:bg-destructive/90 disabled:opacity-50 disabled:cursor-not-allowed transition">
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />} Delete my account
            </button>
          </div>
        </div>
      </div>
    </section>
  )
}

// ── Page ───────────────────────────────────────────────────────────────────

export function SettingsPage() {
  const { search } = useLocation()
  const onboarding = new URLSearchParams(search).has('onboarding')
  const [settings, setSettings] = useState<AiSettings | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    getAiSettings().then(setSettings).catch(e => setError(errMsg(e)))
  }, [])

  const connected = settings?.providers.filter(p => p.connected).length ?? 0

  return (
    <div className="min-h-screen bg-app text-foreground">
      <Toaster theme="dark" position="bottom-right" richColors />
      <AppHeader />
      <main className="max-w-4xl mx-auto px-4 sm:px-6 py-10 sm:py-14 space-y-6">
        <div>
          <h1 className="font-serif text-4xl sm:text-5xl leading-tight">{onboarding ? 'Connect your AI' : 'Settings'}</h1>
          <p className="mt-3 text-muted-foreground max-w-2xl">
            {onboarding
              ? 'Add an API key from any provider below. We verify it, encrypt it, and pick sensible default models — you can change them any time.'
              : 'Manage your profile, provider keys and which models run your interviews.'}
          </p>
        </div>

        {settings && (
          <div className={`rounded-2xl border px-5 py-4 flex flex-col sm:flex-row sm:items-center gap-3 ${
            settings.ready ? 'border-success/30 bg-success/[0.06]' : 'border-warning/30 bg-warning/[0.06]'
          }`}>
            {settings.ready ? <CheckCircle2 className="w-5 h-5 text-success shrink-0" /> : <AlertTriangle className="w-5 h-5 text-warning shrink-0" />}
            <div className="flex-1 text-sm">
              {settings.ready
                ? <><span className="font-medium">You're ready to interview.</span> <span className="text-muted-foreground">Evaluation and transcription models are set.</span></>
                : <><span className="font-medium">Almost there.</span> <span className="text-muted-foreground">
                    {connected === 0 ? 'Add at least one API key.' : 'Choose an evaluation and a transcription model below — transcription needs Groq, OpenAI, Gemini or OpenRouter.'}
                  </span></>}
            </div>
            {settings.ready && (
              <Link href="/app" className={btnPrimary}>Start interview <ArrowRight className="w-4 h-4" /></Link>
            )}
          </div>
        )}

        {error && <div className="rounded-2xl border border-destructive/30 bg-destructive/10 px-5 py-4 text-sm text-destructive">{error}</div>}
        {!settings && !error && (
          <div className="flex items-center gap-2 text-muted-foreground text-sm py-10 justify-center"><Loader2 className="w-4 h-4 animate-spin" /> Loading settings…</div>
        )}

        {settings && (
          <>
            {!onboarding && <ProfileCard />}
            <Card title="API keys" icon={KeyRound} desc="Bring your own keys — usage is billed by your provider directly. Keys are verified, encrypted at rest and never shown again.">
              <div className="space-y-3">
                {settings.providers.map(p => <ProviderCard key={`${p.id}:${p.connected}`} p={p} onChange={setSettings} />)}
              </div>
              <div className="mt-4 flex items-center gap-2 text-xs text-muted-foreground">
                <Lock className="w-3.5 h-3.5" /> Only the last 4 characters of each key are ever displayed.
              </div>
            </Card>
            <ModelsCard
              key={JSON.stringify(settings.selection) + settings.providers.map(p => p.key_hint ?? '-').join()}
              settings={settings}
              onChange={setSettings}
            />
            {!onboarding && <DangerZone />}
          </>
        )}
      </main>
    </div>
  )
}
