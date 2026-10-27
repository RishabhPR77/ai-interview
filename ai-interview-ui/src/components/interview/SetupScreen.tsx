import { useEffect, useRef, useState } from "react";
import {
  Upload, FileText, Loader2, Sparkles, ArrowRight, Check,
  Mic, Eye, Brain, Activity, Shield, ChevronRight, AlertTriangle,
  ClipboardList, Play, TrendingUp, Video, BarChart3, AudioLines
} from "lucide-react";
import { parseFileToText, startInterview, detectSeniority, type StartResponse, type SeniorityResult } from "@/lib/interview-api";
import { preloadMediaPipe } from "@/lib/mediapipe-loader";
import { AppHeader } from "@/components/AppHeader";
import { ApiError } from "@/lib/api";
import { getAiSettings, type AiSettings } from "@/lib/account-api";
import { useAuth } from "@/lib/auth";
import { Link } from "@/lib/router";

interface Props {
  onStarted: (data: StartResponse, ctx: { candidateName: string; jobTitle: string }) => void;
}

function extractJobTitle(jd: string): string {
  const firstLine = jd.split("\n").map(l => l.trim()).find(Boolean) ?? "";
  const m = firstLine.match(/^(?:job title[:\-]\s*)?(.{3,80})$/i);
  return m ? m[1].replace(/[*#>•\-]+/g, "").trim() : "Candidate Interview";
}

const LEVEL_COLORS: Record<string, string> = {
  junior: "text-success border-success/40 bg-success/10",
  mid:    "text-warning border-warning/40 bg-warning/10",
  senior: "text-primary border-primary/40 bg-primary/10",
};

const TYPE_LABELS: Record<string, string> = {
  technical: "Technical",
  behavioral: "Behavioral",
  mixed: "Mixed",
};

const HOW_IT_WORKS = [
  {
    icon: ClipboardList,
    title: "Set up the role",
    desc: "Paste the job description and upload your resume. AI auto-detects the seniority level and interview type.",
  },
  {
    icon: Play,
    title: "Answer on video",
    desc: "Respond to 8 adaptive questions on camera. Your audio, gaze, and content are analysed as you speak.",
  },
  {
    icon: TrendingUp,
    title: "Review your report",
    desc: "Get a detailed scorecard with strengths, improvement areas, filler word highlights, and confidence trends.",
  },
];

const ASSESS_PILLARS = [
  { icon: Brain,    label: "Content & Depth",   sub: "Relevance and technical accuracy" },
  { icon: Mic,      label: "Communication",      sub: "Clarity, pace, and filler words"  },
  { icon: Eye,      label: "Eye Contact",        sub: "Camera engagement analysis"       },
  { icon: Activity, label: "Confidence",         sub: "Tone, hedging, and language score" },
];

function AiStatus({ settings }: { settings: AiSettings | null }) {
  if (!settings) return null;
  const label = (id: string | null) => settings.providers.find(p => p.id === id)?.label ?? id;
  const sel = settings.selection;
  if (!settings.ready) {
    return (
      <div className="rounded-xl border border-warning/30 bg-warning/[0.07] px-4 py-3.5 flex items-start gap-3">
        <AlertTriangle className="w-4 h-4 text-warning mt-0.5 shrink-0" />
        <div className="flex-1 text-sm">
          <div className="font-medium">Connect an AI provider first</div>
          <div className="text-muted-foreground text-xs mt-0.5">
            Interviews run on your own API key. Add one and choose evaluation + transcription models.
          </div>
        </div>
        <Link href="/settings?onboarding=1" className="shrink-0 text-xs font-medium px-3 py-1.5 rounded-lg bg-warning text-warning-foreground hover:opacity-90 transition">
          Set up
        </Link>
      </div>
    );
  }
  return (
    <div className="rounded-xl border border-border bg-input/30 px-4 py-3 flex items-center gap-3 text-xs">
      <div className="flex-1 min-w-0 space-y-1">
        <div className="flex items-center gap-1.5 truncate">
          <Brain className="w-3.5 h-3.5 text-primary shrink-0" />
          <span className="text-muted-foreground">Evaluation</span>
          <span className="font-mono truncate">{label(sel.eval_provider)} · {sel.eval_model}</span>
        </div>
        <div className="flex items-center gap-1.5 truncate">
          <AudioLines className="w-3.5 h-3.5 text-primary shrink-0" />
          <span className="text-muted-foreground">Transcription</span>
          <span className="font-mono truncate">{label(sel.stt_provider)} · {sel.stt_model}</span>
        </div>
      </div>
      <Link href="/settings#models" className="shrink-0 text-primary hover:underline">Change</Link>
    </div>
  );
}

export function SetupScreen({ onStarted }: Props) {
  const { user } = useAuth();
  const [name, setName] = useState(user?.name ?? "");
  const [ai, setAi] = useState<AiSettings | null>(null);
  const [jd, setJd] = useState("");
  const [resumeFile, setResumeFile] = useState<File | null>(null);
  const [resumeText, setResumeText] = useState("");
  const [parsing, setParsing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [detected, setDetected] = useState<SeniorityResult | null>(null);
  const [detecting, setDetecting] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const words = jd.trim().split(/\s+/).length;
    if (words < 20 || !ai?.ready) {
      setDetected(null);
      return;
    }
    setDetecting(true);
    const timer = setTimeout(async () => {
      try {
        const result = await detectSeniority(jd, resumeText);
        setDetected(result);
      } catch {
        // silently ignore
      } finally {
        setDetecting(false);
      }
    }, 1500);
    return () => {
      clearTimeout(timer);
      setDetecting(false);
    };
  }, [jd, resumeText, ai?.ready]);

  useEffect(() => {
    getAiSettings().then(setAi).catch(() => {});
  }, []);

  // ── Preload MediaPipe in the background ──────────────────────────────
  // The camera-check screen needs the FaceMesh WASM + model binary
  // (several MB), which is only fetched once `.initialize()` runs.
  // Kicking that off here means it's already downloaded AND initialized
  // by the time the user reaches camera-check, so it loads instantly
  // instead of showing a long loading state.
  useEffect(() => {
    preloadMediaPipe().catch(() => {
      // If it fails here, camera-check will retry on its own.
    });
  }, []);

  async function handleFile(f: File) {
    setParsing(true);
    setError(null);
    try {
      const text = await parseFileToText(f);
      setResumeFile(f);
      setResumeText(text);
    } catch (e: any) {
      setError(`Could not parse file: ${e.message}`);
    } finally {
      setParsing(false);
    }
  }

  async function handleBegin() {
    setError(null);
    if (!name.trim() || !jd.trim()) {
      setError("Please fill in your name and the job description.");
      return;
    }
    if (!resumeText.trim() || resumeText.trim().length < 50) {
      setError("Please upload your resume — it's required to personalise your interview questions.");
      return;
    }
    setSubmitting(true);
    try {
      const jobTitle = extractJobTitle(jd);
      const data = await startInterview({
        job_title: jobTitle,
        job_description: jd,
        candidate_name: name,
        candidate_resume: resumeText,
        num_questions: 8,
        interview_type: detected?.interview_type ?? "mixed",
        difficulty: detected?.difficulty ?? "mid",
        rubric: {
          technical_depth: 35,
          problem_solving: 25,
          communication_clarity: 20,
          confidence: 10,
          cultural_fit: 10,
        },
      });
      onStarted(data, { candidateName: name, jobTitle });
    } catch (e: any) {
      if (e instanceof ApiError && e.code === "ai_not_configured") {
        getAiSettings().then(setAi).catch(() => {});
      }
      setError(e.message ?? "Failed to start interview");
    } finally {
      setSubmitting(false);
    }
  }

  const wordCount = jd.trim() ? jd.trim().split(/\s+/).length : 0;
  const readyToBegin = !!ai?.ready && name.trim().length > 1 && wordCount >= 10 && resumeText.trim().length >= 50;

  return (
    <div className="min-h-screen bg-app text-foreground">

      <AppHeader>
        <div className="hidden md:flex items-center gap-1.5 text-xs text-muted-foreground">
          <span className="px-2.5 py-1 rounded-full bg-primary/15 text-primary border border-primary/30 font-medium">
            1 · Setup
          </span>
          <ChevronRight className="w-3 h-3" />
          <span className="flex items-center gap-1"><Video className="w-3 h-3" /> Interview</span>
          <ChevronRight className="w-3 h-3" />
          <span className="flex items-center gap-1"><BarChart3 className="w-3 h-3" /> Report</span>
        </div>
      </AppHeader>

      {/* ── Main layout ──────────────────────────────────────────── */}
      <main className="max-w-7xl mx-auto px-6 lg:px-10 py-12 grid lg:grid-cols-[1fr_1.05fr] gap-12 lg:gap-16 items-start">

        {/* ── LEFT: Context panel ─────────────────────────────── */}
        <section className="space-y-8 lg:sticky lg:top-24">

          {/* Heading */}
          <div>
            <div className="inline-flex items-center gap-2 text-xs px-3 py-1.5 rounded-full border border-primary/30 bg-primary/10 text-primary mb-5 font-medium">
              <Sparkles className="w-3 h-3" />
              AI Interview Practice
            </div>
            <h1 className="font-serif text-[clamp(2.2rem,5vw,3.6rem)] leading-[1.05] tracking-tight">
              Prepare Before<br />You Apply
            </h1>
            <p className="mt-4 text-base text-muted-foreground leading-relaxed max-w-md">
              Practice with AI-generated questions tailored to the job description — then review detailed feedback before the real interview.
            </p>
          </div>

          {/* How it works */}
          <div>
            <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground mb-4 font-medium">
              How it works
            </div>
            <div className="space-y-4">
              {HOW_IT_WORKS.map((step, i) => {
                const Icon = step.icon;
                return (
                  <div key={i} className="flex gap-4 group">
                    <div className="w-8 h-8 rounded-lg bg-secondary border border-border flex items-center justify-center shrink-0 group-hover:border-primary/40 group-hover:bg-primary/10 transition">
                      <Icon className="w-4 h-4 text-muted-foreground group-hover:text-primary transition" />
                    </div>
                    <div className="pt-0.5">
                      <div className="text-sm font-medium">{step.title}</div>
                      <div className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{step.desc}</div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* What we assess */}
          <div>
            <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground mb-4 font-medium">
              What we assess
            </div>
            <div className="grid grid-cols-2 gap-3">
              {ASSESS_PILLARS.map((p) => {
                const Icon = p.icon;
                return (
                  <div
                    key={p.label}
                    className="bg-surface border border-border rounded-xl p-3.5 flex items-start gap-3 hover:border-primary/30 transition"
                  >
                    <Icon className="w-4 h-4 text-primary mt-0.5 shrink-0" />
                    <div>
                      <div className="text-sm font-medium leading-snug">{p.label}</div>
                      <div className="text-[11px] text-muted-foreground mt-0.5">{p.sub}</div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Attribution */}
          <div className="flex items-center gap-2 text-xs text-muted-foreground pt-2 border-t border-border">
            <Shield className="w-3 h-3" />
            Results are for practice only and are never shared with employers
          </div>
        </section>

        {/* ── RIGHT: Form ─────────────────────────────────────── */}
        <section>
          <div className="relative">
            <div className="absolute -inset-px rounded-[28px] bg-gradient-to-b from-primary/30 via-border to-transparent opacity-50" />
            <div className="relative bg-surface/95 backdrop-blur-xl border border-border rounded-[28px] p-6 md:p-8 shadow-2xl">

              <div className="flex items-center justify-between mb-6">
                <div>
                  <div className="text-[11px] uppercase tracking-[0.18em] text-primary font-medium">Step 1 of 3</div>
                  <h2 className="font-serif text-2xl mt-1">Tell us about you</h2>
                </div>
                <div className="text-xs text-muted-foreground">~ 2 min</div>
              </div>

              <div className="space-y-5">

                <AiStatus settings={ai} />

                {/* Name */}
                <FloatField
                  label="Your full name"
                  value={name}
                  onChange={setName}
                  placeholder="e.g. Rishabh Patidar"
                />

                {/* Job description */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className="text-xs uppercase tracking-wider text-muted-foreground font-medium">
                      Job description
                    </label>
                    <span className={`text-[11px] tabular-nums ${wordCount >= 10 ? "text-success" : "text-muted-foreground"}`}>
                      {wordCount} words {wordCount >= 10 && "· ready"}
                    </span>
                  </div>
                  <div className="relative group">
                    <textarea
                      value={jd}
                      onChange={(e) => setJd(e.target.value)}
                      placeholder="Paste the full job description. We'll auto-detect experience level and tailor your practice interview..."
                      rows={7}
                      className="peer w-full bg-input/60 border border-border rounded-xl px-4 py-3 text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:border-primary/60 focus:bg-input transition resize-y text-sm leading-relaxed"
                    />
                    <div className="pointer-events-none absolute inset-0 rounded-xl ring-0 peer-focus:ring-4 ring-primary/15 transition" />
                  </div>

                  {/* Auto-detect badge */}
                  <div className="mt-2 h-6 flex items-center">
                    {detecting && (
                      <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                        <Loader2 className="w-3 h-3 animate-spin" /> Analysing role…
                      </span>
                    )}
                    {detected && !detecting && (
                      <div className={`inline-flex items-center gap-1.5 text-[11px] px-2.5 py-1 rounded-full border font-medium ${LEVEL_COLORS[detected.difficulty]}`}>
                        <Sparkles className="w-3 h-3" />
                        Auto-detected: <strong className="capitalize">{detected.difficulty}</strong>
                        {" · "}{TYPE_LABELS[detected.interview_type]}
                        <span className="ml-1 opacity-60 font-normal normal-case">— {detected.reasoning}</span>
                      </div>
                    )}
                  </div>
                </div>

                {/* Resume upload */}
                <div>
                  <label className="text-xs uppercase tracking-wider text-muted-foreground font-medium mb-2 block">
                    Resume{" "}
                    <span className="text-muted-foreground/60 normal-case tracking-normal">
                      (required · personalises your questions)
                    </span>
                  </label>
                  <input
                    ref={fileRef}
                    type="file"
                    accept=".pdf,.txt,application/pdf,text/plain"
                    className="hidden"
                    onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
                  />
                  <button
                    type="button"
                    onClick={() => fileRef.current?.click()}
                    className="w-full group flex items-center gap-3 px-4 py-3.5 rounded-xl border border-dashed border-border bg-input/30 hover:bg-input hover:border-primary/40 transition text-left"
                  >
                    <div
                      className={`w-9 h-9 rounded-lg flex items-center justify-center transition ${
                        resumeFile
                          ? "bg-success/15 text-success"
                          : "bg-secondary text-muted-foreground group-hover:text-primary"
                      }`}
                    >
                      {parsing ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : resumeFile ? (
                        <Check className="w-4 h-4" />
                      ) : (
                        <Upload className="w-4 h-4" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium truncate">
                        {parsing
                          ? "Parsing your resume…"
                          : resumeFile
                          ? resumeFile.name
                          : "Drop or browse PDF / TXT"}
                      </div>
                      <div className="text-[11px] text-muted-foreground">
                        {resumeFile
                          ? `${(resumeText.length / 1000).toFixed(1)}k chars parsed`
                          : "Helps tailor questions to your background"}
                      </div>
                    </div>
                    {resumeFile && <FileText className="w-4 h-4 text-muted-foreground" />}
                  </button>
                </div>

                {/* Error */}
                {error && (
                  <div className="text-sm text-destructive bg-destructive/10 border border-destructive/30 rounded-xl px-4 py-3 flex items-start gap-2">
                    <span className="mt-0.5">⚠</span>
                    {error}
                  </div>
                )}

                {/* Begin button */}
                <button
                  onClick={handleBegin}
                  disabled={submitting || !readyToBegin}
                  className="relative w-full overflow-hidden group bg-primary hover:bg-primary/90 disabled:opacity-60 disabled:cursor-not-allowed text-primary-foreground font-medium px-6 py-4 rounded-xl transition glow-primary flex items-center justify-center gap-2"
                >
                  <span className="absolute inset-0 bg-gradient-to-r from-transparent via-white/15 to-transparent -translate-x-full group-hover:translate-x-full transition-transform duration-700" />
                  {submitting ? (
                    <>
                      <Loader2 className="w-5 h-5 animate-spin" /> Preparing your session…
                    </>
                  ) : (
                    <>
                      Start Practice Interview{" "}
                      <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
                    </>
                  )}
                </button>

                <div className="flex items-center justify-between pt-1 text-[11px] text-muted-foreground">
                  <div className="flex items-center gap-1.5">
                    <Shield className="w-3 h-3" /> Recordings deleted after analysis
                  </div>
                  <div className={readyToBegin ? "text-success" : ""}>
                    {readyToBegin
                      ? "● Ready to begin"
                      : !ai?.ready
                      ? "○ Connect an AI provider"
                      : !name.trim() || wordCount < 10
                      ? "○ Fill name & job description"
                      : "○ Upload your resume to continue"}
                  </div>
                </div>

              </div>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}

function FloatField({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
}) {
  return (
    <div>
      <label className="text-xs uppercase tracking-wider text-muted-foreground font-medium mb-2 block">
        {label}
      </label>
      <div className="relative group">
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className="peer w-full bg-input/60 border border-border rounded-xl px-4 py-3 text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:border-primary/60 focus:bg-input transition"
        />
        <div className="pointer-events-none absolute inset-0 rounded-xl ring-0 peer-focus:ring-4 ring-primary/15 transition" />
      </div>
    </div>
  );
}