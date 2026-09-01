import { useState } from "react";
import { TrendingUp, TrendingDown, Minus, ChevronDown, ChevronUp } from "lucide-react";
import type { ReportResponse, QuestionScore } from "@/lib/interview-api";

interface Props {
  current: ReportResponse;
  previous: ReportResponse;
}

function diff(curr: number, prev: number) {
  return Math.round((curr - prev) * 10) / 10;
}

function DiffBadge({ value, invert = false }: { value: number; invert?: boolean }) {
  const good = invert ? value < 0 : value > 0;
  const neutral = value === 0;
  const color = neutral ? "text-muted-foreground" : good ? "text-success" : "text-destructive";
  const Icon = neutral ? Minus : good ? TrendingUp : TrendingDown;
  const sign = value > 0 ? "+" : "";
  return (
    <span className={`inline-flex items-center gap-1 font-medium text-sm ${color}`}>
      <Icon className="w-3.5 h-3.5" />
      {sign}{value}
    </span>
  );
}

function avgWpm(qs: QuestionScore[]): number {
  const vals = qs.map(q => q.wpm ?? q.audio_signals?.words_per_minute ?? 0).filter(Boolean);
  return vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : 0;
}

function totalFillers(qs: QuestionScore[]): number {
  return qs.reduce((sum, q) => sum + (q.audio_signals?.filler_word_count ?? 0), 0);
}

function avgScore(qs: QuestionScore[], key: keyof QuestionScore): number {
  const vals = qs.map(q => q[key] as number).filter(v => typeof v === "number");
  return vals.length ? Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 10) / 10 : 0;
}

function prettyLabel(k: string) {
  return k.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
}

export function ComparePanel({ current, previous }: Props) {
  const [open, setOpen] = useState(false);

  const overallDiff = diff(current.overall_score, previous.overall_score);

  const currQs = current.per_question_scores ?? [];
  const prevQs = previous.per_question_scores ?? [];

  const hasAudio = currQs.some(q => q.audio_signals) || prevQs.some(q => q.audio_signals);

  const currWpm = avgWpm(currQs);
  const prevWpm = avgWpm(prevQs);
  const wpmDiff = diff(currWpm, prevWpm);

  const currFillers = totalFillers(currQs);
  const prevFillers = totalFillers(prevQs);
  const fillerDiff = diff(currFillers, prevFillers);

  const currContent = avgScore(currQs, "content_score");
  const prevContent = avgScore(prevQs, "content_score");
  const currComms = avgScore(currQs, "communication_score");
  const prevComms = avgScore(prevQs, "communication_score");
  const currConf = avgScore(currQs, "confidence_score");
  const prevConf = avgScore(prevQs, "confidence_score");

  const categories = Object.keys(current.breakdown ?? {});

  return (
    <div className="bg-surface border border-border rounded-2xl overflow-hidden">
      {/* Toggle header */}
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-6 py-4 hover:bg-white/5 transition"
      >
        <div className="flex items-center gap-3">
          <TrendingUp className="w-5 h-5 text-primary" />
          <span className="font-medium">Compare with Previous Attempt</span>
          <span className={`text-sm font-semibold px-2 py-0.5 rounded-full ${
            overallDiff > 0 ? "bg-success/15 text-success" :
            overallDiff < 0 ? "bg-destructive/15 text-destructive" :
            "bg-secondary text-muted-foreground"
          }`}>
            {overallDiff > 0 ? "+" : ""}{overallDiff} overall
          </span>
        </div>
        {open ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
      </button>

      {open && (
        <div className="px-6 pb-6 space-y-6 border-t border-border pt-5">

          {/* Overall score */}
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">Overall Score</span>
            <div className="flex items-center gap-3 text-sm">
              <span className="text-muted-foreground">{Math.round(previous.overall_score)}</span>
              <span className="text-muted-foreground">→</span>
              <span className="font-semibold text-foreground">{Math.round(current.overall_score)}</span>
              <DiffBadge value={overallDiff} />
            </div>
          </div>

          {/* Category breakdown diffs */}
          {categories.length > 0 && (
            <div>
              <p className="text-xs uppercase tracking-wider text-muted-foreground mb-3">Category Scores</p>
              <div className="space-y-2">
                {categories.map(cat => {
                  const c = Math.round(current.breakdown[cat] ?? 0);
                  const p = Math.round(previous.breakdown[cat] ?? 0);
                  const d = diff(c, p);
                  const pct = (c / 10) * 100;
                  return (
                    <div key={cat}>
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-sm">{prettyLabel(cat)}</span>
                        <div className="flex items-center gap-3 text-sm">
                          <span className="text-muted-foreground">{p}/10</span>
                          <span className="text-muted-foreground">→</span>
                          <span className="font-medium">{c}/10</span>
                          <DiffBadge value={d} />
                        </div>
                      </div>
                      <div className="h-1.5 bg-secondary rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all ${
                            d > 0 ? "bg-success" : d < 0 ? "bg-destructive" : "bg-muted-foreground"
                          }`}
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Per-answer averages */}
          <div>
            <p className="text-xs uppercase tracking-wider text-muted-foreground mb-3">Answer Quality Averages</p>
            <div className="grid grid-cols-3 gap-3">
              {[
                { label: "Content", curr: currContent, prev: prevContent, d: diff(currContent, prevContent) },
                { label: "Communication", curr: currComms, prev: prevComms, d: diff(currComms, prevComms) },
                { label: "Confidence", curr: currConf, prev: prevConf, d: diff(currConf, prevConf) },
              ].map(({ label, curr, prev: p, d }) => (
                <div key={label} className="bg-background/50 border border-border rounded-xl p-3 text-center">
                  <div className="text-xs text-muted-foreground mb-1">{label}</div>
                  <div className="text-lg font-semibold">{curr}</div>
                  <div className="text-xs text-muted-foreground">was {p}</div>
                  <div className="mt-1"><DiffBadge value={d} /></div>
                </div>
              ))}
            </div>
          </div>

          {/* Audio signals */}
          {hasAudio && (currWpm > 0 || prevWpm > 0 || currFillers > 0 || prevFillers > 0) && (
            <div>
              <p className="text-xs uppercase tracking-wider text-muted-foreground mb-3">Speech Signals</p>
              <div className="grid grid-cols-2 gap-3">
                {currWpm > 0 && (
                  <div className="bg-background/50 border border-border rounded-xl p-4">
                    <div className="text-xs text-muted-foreground mb-1">Avg WPM</div>
                    <div className="flex items-end justify-between">
                      <div>
                        <div className="text-xl font-semibold">{currWpm}</div>
                        <div className="text-xs text-muted-foreground">was {prevWpm}</div>
                      </div>
                      <DiffBadge value={wpmDiff} />
                    </div>
                    <div className="text-xs text-muted-foreground mt-1">ideal: 120–160</div>
                  </div>
                )}
                {(currFillers > 0 || prevFillers > 0) && (
                  <div className="bg-background/50 border border-border rounded-xl p-4">
                    <div className="text-xs text-muted-foreground mb-1">Total Filler Words</div>
                    <div className="flex items-end justify-between">
                      <div>
                        <div className="text-xl font-semibold">{currFillers}</div>
                        <div className="text-xs text-muted-foreground">was {prevFillers}</div>
                      </div>
                      <DiffBadge value={fillerDiff} invert />
                    </div>
                    <div className="text-xs text-muted-foreground mt-1">lower is better</div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Verdict */}
          <div className={`rounded-xl p-4 text-sm ${
            overallDiff > 0 ? "bg-success/10 border border-success/20 text-success" :
            overallDiff < 0 ? "bg-destructive/10 border border-destructive/20 text-destructive" :
            "bg-secondary border border-border text-muted-foreground"
          }`}>
            {overallDiff > 5
              ? "Strong improvement — you're clearly getting better. Keep it up."
              : overallDiff > 0
              ? "Slight improvement over your last attempt. Focus on your weakest category to push further."
              : overallDiff === 0
              ? "Same score as last time. Try to vary your examples and reduce filler words."
              : "Score dipped from last attempt. Review your weaknesses and try again."}
          </div>

        </div>
      )}
    </div>
  );
}