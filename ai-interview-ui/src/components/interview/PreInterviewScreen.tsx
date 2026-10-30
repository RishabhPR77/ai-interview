import { useState } from "react";
import {
  CheckCircle2, Circle, ChevronRight, Briefcase,
  Video, BarChart3, Clock, HelpCircle, Mic,
  Eye, Brain, ArrowRight, BookOpen, Zap,
} from "lucide-react";
import type { StartResponse } from "@/lib/interview-api";

interface Props {
  start: StartResponse;
  jobTitle: string;
  candidateName: string;
  rubric: Record<string, number>;
  onBegin: () => void;
  onBack: () => void;
}

const CHECKLIST = [
  { id: "quiet",  label: "I'm in a quiet room with no interruptions" },
  { id: "light",  label: "My face is well lit (light in front of me)" },
  { id: "phone",  label: "My phone is away or on silent" },
  { id: "record", label: "I understand my video & audio will be recorded and scored" },
];

const TIPS = [
  { icon: BookOpen, title: "Use STAR", body: "Structure answers as Situation → Task → Action → Result." },
  { icon: Eye,      title: "Eye contact", body: "Look at the camera, not the screen. It reads as confident." },
  { icon: Mic,      title: "Speak clearly", body: "Steady pace, full sentences. Avoid 'um', 'like', 'you know'." },
  { icon: Brain,    title: "Be specific", body: "Name real projects, real numbers, real outcomes." },
];

const CATEGORY_COLORS: Record<string, string> = {
  technical_depth:       "bg-blue-500/10 text-blue-800 border-blue-700/20",
  problem_solving:       "bg-purple-500/10 text-purple-800 border-purple-700/20",
  communication_clarity: "bg-teal-500/10 text-teal-800 border-teal-700/20",
  confidence:            "bg-amber-500/15 text-amber-800 border-amber-700/20",
  cultural_fit:          "bg-green-500/10 text-green-800 border-green-700/20",
};

const CATEGORY_LABELS: Record<string, string> = {
  technical_depth:       "Technical depth",
  problem_solving:       "Problem solving",
  communication_clarity: "Communication",
  confidence:            "Confidence",
  cultural_fit:          "Cultural fit",
};

export function PreInterviewScreen({ start, jobTitle, candidateName, rubric, onBegin, onBack }: Props) {
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const allChecked = CHECKLIST.every(c => checked[c.id]);

  const toggle = (id: string) => setChecked(p => ({ ...p, [id]: !p[id] }));

  const durationMin = start.estimated_duration_minutes ?? start.total_questions * 2;

  return (
    <div className="min-h-screen bg-app text-foreground flex flex-col">

      {/* Header */}
      <header className="sticky top-0 z-20 bg-surface/80 backdrop-blur-xl border-b border-border shrink-0">
        <div className="max-w-7xl mx-auto px-6 h-14 flex items-center gap-3">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-primary/15 border border-primary/30 flex items-center justify-center">
              <Briefcase className="w-3.5 h-3.5 text-primary" />
            </div>
            <span className="font-serif text-base leading-none">tejaskrit</span>
          </div>
          <div className="flex items-center gap-1.5 text-sm text-muted-foreground ml-1">
            <ChevronRight className="w-3.5 h-3.5" />
            <span className="text-foreground font-medium">{jobTitle}</span>
          </div>
          <div className="ml-auto hidden md:flex items-center gap-1.5 text-xs text-muted-foreground">
            <span className="flex items-center gap-1"><CheckCircle2 className="w-3 h-3 text-success" /> Setup</span>
            <ChevronRight className="w-3 h-3" />
            <span className="flex items-center gap-1"><CheckCircle2 className="w-3 h-3 text-success" /> System check</span>
            <ChevronRight className="w-3 h-3" />
            <span className="px-2.5 py-1 rounded-full bg-primary/15 text-primary border border-primary/30 font-medium">2 · Pre-interview</span>
            <ChevronRight className="w-3 h-3" />
            <span className="flex items-center gap-1"><Video className="w-3 h-3" /> Interview</span>
            <ChevronRight className="w-3 h-3" />
            <span className="flex items-center gap-1"><BarChart3 className="w-3 h-3" /> Report</span>
          </div>
        </div>
      </header>

      {/* Blobs */}
      <div className="pointer-events-none fixed -top-40 -left-40 w-[520px] h-[520px] rounded-full blur-[120px] opacity-25 bg-primary" />
      <div className="pointer-events-none fixed top-1/3 -right-40 w-[480px] h-[480px] rounded-full blur-[120px] opacity-20 bg-[#e8b04a]" />

      <div className="flex-1 flex items-start justify-center px-4 py-10">
        <div className="w-full max-w-2xl space-y-5">

          {/* Title */}
          <div>
            <div className="text-[11px] uppercase tracking-[0.18em] text-primary font-medium">Step 2 of 3</div>
            <h2 className="font-serif text-2xl mt-1">You're almost in.</h2>
            <p className="text-sm text-muted-foreground mt-1">
              Hi <span className="text-foreground font-medium">{candidateName}</span> — read this before you begin.
            </p>
          </div>

          {/* Interview brief */}
          <div className="rounded-2xl border border-border bg-surface/80 p-5 space-y-4">
            <div className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Interview brief</div>
            <div className="grid grid-cols-3 gap-3">
              <div className="rounded-xl border border-border bg-background/50 px-4 py-3 text-center">
                <div className="text-2xl font-serif font-light">{start.total_questions}</div>
                <div className="text-[11px] text-muted-foreground mt-0.5">Questions</div>
              </div>
              <div className="rounded-xl border border-border bg-background/50 px-4 py-3 text-center">
                <div className="text-2xl font-serif font-light flex items-baseline justify-center gap-0.5">
                  {durationMin}<span className="text-sm font-sans text-muted-foreground">min</span>
                </div>
                <div className="text-[11px] text-muted-foreground mt-0.5">Est. duration</div>
              </div>
              <div className="rounded-xl border border-border bg-background/50 px-4 py-3 text-center">
                <div className="text-2xl font-serif font-light flex items-baseline justify-center gap-0.5">
                  ~2<span className="text-sm font-sans text-muted-foreground">min</span>
                </div>
                <div className="text-[11px] text-muted-foreground mt-0.5">Per answer</div>
              </div>
            </div>

            {/* Scoring weights */}
            <div>
              <div className="text-[11px] text-muted-foreground mb-2 font-medium">How you'll be scored</div>
              <div className="flex flex-wrap gap-2">
                {Object.entries(rubric).map(([key, pct]) => (
                  <div key={key} className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[11px] font-medium ${CATEGORY_COLORS[key] ?? "bg-border/30 text-muted-foreground border-border"}`}>
                    <span>{CATEGORY_LABELS[key] ?? key}</span>
                    <span className="opacity-60">{pct}%</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Format note */}
            <div className="flex items-start gap-2.5 text-xs text-muted-foreground border-t border-border pt-3">
              <HelpCircle className="w-3.5 h-3.5 mt-0.5 shrink-0 text-primary/60" />
              <span>Some questions may trigger a follow-up if the AI needs more detail. Answer naturally and completely.</span>
            </div>
          </div>

          {/* Tips */}
          <div className="rounded-2xl border border-border bg-surface/80 p-5 space-y-3">
            <div className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Tips for a great score</div>
            <div className="grid grid-cols-2 gap-3">
              {TIPS.map(({ icon: Icon, title, body }) => (
                <div key={title} className="flex items-start gap-3 rounded-xl border border-border bg-background/40 px-3.5 py-3">
                  <div className="w-7 h-7 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center shrink-0 mt-0.5">
                    <Icon className="w-3.5 h-3.5 text-primary" />
                  </div>
                  <div>
                    <div className="text-xs font-semibold">{title}</div>
                    <div className="text-[11px] text-muted-foreground mt-0.5 leading-relaxed">{body}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Readiness checklist */}
          <div className="rounded-2xl border border-border bg-surface/80 p-5 space-y-3">
            <div className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Before you begin</div>
            <div className="space-y-2">
              {CHECKLIST.map(item => (
                <button
                  key={item.id}
                  onClick={() => toggle(item.id)}
                  className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl border text-left transition-all ${
                    checked[item.id]
                      ? "border-success/40 bg-success/8 text-foreground"
                      : "border-border bg-background/40 text-muted-foreground hover:border-border/80 hover:text-foreground"
                  }`}
                >
                  {checked[item.id]
                    ? <CheckCircle2 className="w-4 h-4 text-success shrink-0" />
                    : <Circle className="w-4 h-4 shrink-0 opacity-40" />
                  }
                  <span className="text-sm">{item.label}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Actions */}
          <div className="flex gap-3 pb-4">
            <button
              onClick={onBack}
              className="px-5 py-3 rounded-xl border border-border bg-surface hover:bg-secondary text-sm font-medium transition"
            >
              ← Back
            </button>
            <button
              onClick={onBegin}
              disabled={!allChecked}
              className="flex-1 relative overflow-hidden group bg-primary hover:bg-primary/90 disabled:opacity-35 disabled:cursor-not-allowed text-primary-foreground font-medium px-6 py-3 rounded-xl transition glow-primary flex items-center justify-center gap-2 text-sm"
            >
              <span className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent -translate-x-full group-hover:translate-x-full transition-transform duration-700" />
              {allChecked
                ? <><Zap className="w-4 h-4" /> Begin interview</>
                : <>Check all boxes above to continue <ArrowRight className="w-4 h-4" /></>
              }
            </button>
          </div>

        </div>
      </div>
    </div>
  );
}