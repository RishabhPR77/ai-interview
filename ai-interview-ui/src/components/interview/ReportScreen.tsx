import { AlertTriangle, CheckCircle2, XCircle, RotateCcw, Download, Loader2, AlertOctagon, Award, Briefcase, ChevronDown } from "lucide-react";
import { useState, type ReactNode } from "react";
import type { ReportResponse, QuestionScore } from "@/lib/interview-api";
import { RadarChart, ConfidenceTrendChart, WpmChart, FillerWordChart, EyeContactTimelineChart, PostureChart, FatigueChart, AttentionArcSummary, BodyLanguageCard } from "./PerformanceCharts";
import { downloadReportPDF } from "@/lib/export-pdf";

interface Props {
  report: ReportResponse;
  candidateName: string;
  jobTitle: string;
  onRestart: () => void;
  endedEarly?: boolean;
}

function scoreColor(s: number): string {
  if (s >= 75) return "text-success border-success/30 bg-success/10";
  if (s >= 50) return "text-warning border-warning/30 bg-warning/10";
  return "text-destructive border-destructive/30 bg-destructive/10";
}

function prettyLabel(k: string) {
  return k.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
}

function highlightFillers(text: string, fillerWords: string[]): ReactNode {
  if (!fillerWords.length || !text) return <>{text}</>;
  const fillerSet = new Set(fillerWords.map(w => w.toLowerCase().trim()).filter(Boolean));
  if (!fillerSet.size) return <>{text}</>;
  const escaped = [...fillerSet].map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const pattern = new RegExp(`\\b(${escaped.join('|')})\\b`, 'gi');

  const parts: ReactNode[] = [];
  let last = 0;
  let match: RegExpExecArray | null;
  let key = 0;
  pattern.lastIndex = 0;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > last) parts.push(text.slice(last, match.index));
    parts.push(
      <mark
        key={key++}
        className="bg-warning/25 text-warning rounded px-0.5 font-semibold not-italic"
        title="Filler word"
      >
        {match[0]}
      </mark>
    );
    last = match.index + match[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return <>{parts}</>;
}

function FillerCount({ q }: { q: QuestionScore }) {
  const count = q.audio_signals?.filler_word_count ?? 0;
  if (!count) return null;
  return (
    <span className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-warning/15 text-warning border border-warning/30 ml-2">
      {count} filler{count !== 1 ? 's' : ''} highlighted
    </span>
  );
}

export function ReportScreen({ report, candidateName, jobTitle, onRestart, endedEarly }: Props) {
  const [pdfLoading, setPdfLoading] = useState(false);
  const [openIndex, setOpenIndex] = useState<number | null>(0);

  const questions = report.per_question_scores ?? [];

  if (endedEarly && questions.length === 0) {
    return (
      <div className="min-h-screen bg-app flex flex-col">
        <header className="sticky top-0 z-20 border-b border-border bg-surface/80 backdrop-blur-xl">
          <div className="max-w-5xl mx-auto px-4 h-14 flex items-center gap-3">
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-lg bg-primary/15 border border-primary/30 flex items-center justify-center">
                <Briefcase className="w-3.5 h-3.5 text-primary" />
              </div>
              <span className="font-serif text-base leading-none">tejaskrit</span>
            </div>
            <div className="h-4 w-px bg-border mx-1" />
            <span className="text-xs text-muted-foreground">AI Interview Practice</span>
          </div>
        </header>
        <div className="flex-1 flex items-center justify-center px-4">
          <div className="text-center max-w-md space-y-6">
            <div className="w-20 h-20 mx-auto rounded-full bg-warning/10 border border-warning/30 flex items-center justify-center">
              <AlertOctagon className="w-10 h-10 text-warning" />
            </div>
            <div>
              <h1 className="font-serif text-3xl">Interview Not Completed</h1>
              <p className="text-muted-foreground mt-3 leading-relaxed">
                The interview was ended before any questions were answered.
                No report could be generated — there&apos;s no data to evaluate.
              </p>
            </div>
            <button
              onClick={onRestart}
              className="inline-flex items-center gap-2 bg-primary hover:bg-primary/90 text-primary-foreground font-medium px-6 py-3 rounded-lg transition glow-primary"
            >
              <RotateCcw className="w-4 h-4" /> Practice Again
            </button>
          </div>
        </div>
      </div>
    );
  }

  const score = Math.round(report.overall_score ?? 0);
  const reco = (report.recommendation ?? "maybe").toString();
  const verdict = verdictFor(reco);
  const level = score >= 75 ? "Strong performance" : score >= 50 ? "Promising, with gaps" : "Needs more practice";
  // Planned questions only: the report counts follow-ups and the intro separately.
  const counts = report as ReportResponse & { questions_answered?: number; total_questions?: number };
  const answered = counts.questions_answered ?? questions.filter(q => q.anomaly_reason !== "no_speech_detected").length;
  const planned = counts.total_questions ?? questions.length;
  const avg = (vals: (number | undefined)[]) => {
    const v = vals.filter((x): x is number => typeof x === "number" && x > 0);
    return v.length ? Math.round(v.reduce((a, b) => a + b, 0) / v.length) : null;
  };
  const avgPace = avg(questions.map(q => q.audio_signals?.words_per_minute ?? q.wpm));
  const avgEye = avg(questions.filter(q => q.video_signals?.video_available !== false).map(q => q.video_signals?.eye_contact_percentage));
  const hasAudio = questions.some(q => q.audio_signals || q.wpm);

  async function handleDownloadPDF() {
    setPdfLoading(true);
    try {
      await downloadReportPDF(report, candidateName, jobTitle);
    } catch (e) {
      console.error('PDF export failed', e);
    } finally {
      setPdfLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-app screen-enter">
      <header className="sticky top-0 z-20 border-b border-border bg-surface/80 backdrop-blur-xl no-print">
        <div className="max-w-3xl mx-auto px-4 h-14 flex items-center gap-3">
          <span className="font-serif text-base">tejaskrit</span>
          <span className="text-xs text-muted-foreground hidden sm:inline">· Your interview report</span>
          <div className="ml-auto flex items-center gap-2">
            <button onClick={handleDownloadPDF} disabled={pdfLoading}
              className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-border hover:bg-secondary transition disabled:opacity-60">
              {pdfLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Download className="w-3 h-3" />} PDF
            </button>
            <button onClick={onRestart}
              className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition">
              <RotateCcw className="w-3 h-3" /> Practice again
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 py-10 space-y-10">
        {/* 1. The result at a glance */}
        <section>
          <p className="text-xs uppercase tracking-[0.2em] text-primary font-semibold">{report.job_title ?? jobTitle}</p>
          <h1 className="font-serif text-4xl sm:text-5xl mt-2">{report.candidate_name ?? candidateName}</h1>

          <div className="mt-6 rounded-3xl border border-border bg-surface p-6 sm:p-8">
            <div className="flex flex-col sm:flex-row sm:items-center gap-6">
              <div>
                <div className="flex items-baseline gap-1">
                  <span className="font-serif text-7xl leading-none">{score}</span>
                  <span className="text-xl text-muted-foreground">/100</span>
                </div>
                <div className="mt-3 h-2 w-56 max-w-full rounded-full bg-secondary overflow-hidden">
                  <div className={`h-full rounded-full ${barColor(score / 10)}`} style={{ width: `${score}%` }} />
                </div>
                <p className="mt-2 text-sm font-medium">{level}</p>
              </div>
              <div className="sm:ml-auto sm:max-w-xs rounded-2xl border border-border bg-background/40 p-4">
                <div className={`inline-block text-xs font-semibold px-3 py-1 rounded-full ${verdict.style}`}>{verdict.label}</div>
                <p className="mt-2 text-sm text-muted-foreground leading-relaxed">{verdict.meaning}</p>
              </div>
            </div>
            {report.summary && <p className="mt-6 text-[15px] leading-relaxed text-foreground/90">{report.summary}</p>}
            <dl className="mt-6 grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
              <Fact label="Questions answered" value={`${answered} of ${planned}`} />
              <Fact label="Duration" value={report.interview_duration_minutes ? `${Math.round(report.interview_duration_minutes)} min` : "—"} />
              <Fact label="Speaking pace" value={avgPace ? `${avgPace} wpm` : "—"} hint="130–160 is ideal" />
              <Fact label="Eye contact" value={avgEye != null ? `${avgEye}%` : "n/a"} hint={avgEye != null ? "of answering time" : "camera off"} />
            </dl>
          </div>

          {endedEarly && (
            <div className="mt-4 flex items-start gap-3 rounded-2xl border border-warning/40 bg-warning/5 px-5 py-4 text-sm">
              <AlertOctagon className="w-5 h-5 text-warning shrink-0 mt-0.5" />
              <span><strong>You ended the interview early.</strong> <span className="text-muted-foreground">The score only covers the questions you answered, so treat it as a rough guide.</span></span>
            </div>
          )}
        </section>

        {/* 2. How the score was worked out */}
        {report.breakdown && Object.keys(report.breakdown).length > 0 && (
          <section>
            <h2 className="font-serif text-2xl">How your score was worked out</h2>
            <p className="mt-1 text-sm text-muted-foreground">Each answer was rated out of 10 in the areas below. Areas that matter more for this role count for more of the final score.</p>
            <div className="mt-5 space-y-4">
              {Object.entries(report.breakdown).map(([k, v]) => (
                <div key={k}>
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="font-medium">{prettyLabel(k)}{report.rubric?.[k] != null && <span className="text-xs text-muted-foreground font-normal"> · counts {report.rubric[k]}%</span>}</span>
                    <span className="font-serif text-xl">{Math.round(v * 10) / 10}<span className="text-sm text-muted-foreground">/10</span></span>
                  </div>
                  <div className="mt-1.5 h-2 rounded-full bg-secondary overflow-hidden">
                    <div className={`h-full rounded-full ${barColor(v)}`} style={{ width: `${Math.max(2, v * 10)}%` }} />
                  </div>
                  {AREA_HINTS[k] && <p className="mt-1 text-xs text-muted-foreground">{AREA_HINTS[k]}</p>}
                </div>
              ))}
            </div>
          </section>
        )}

        {/* 3. Takeaways */}
        <section className="grid sm:grid-cols-2 gap-4">
          <ListCard title="What went well" items={report.strengths} icon={<CheckCircle2 className="w-5 h-5 text-success" />} borderClass="border-l-2 border-success/40" />
          <ListCard title="What to work on" items={report.weaknesses} icon={<XCircle className="w-5 h-5 text-warning" />} borderClass="border-l-2 border-warning/40" />
        </section>
        {report.red_flags && report.red_flags.length > 0 && (
          <ListCard title="Watch out for" items={report.red_flags} icon={<AlertTriangle className="w-5 h-5 text-destructive" />} borderClass="border-l-2 border-destructive/40" />
        )}

        {/* 4. Answer by answer */}
        {questions.length > 0 && (
          <section>
            <h2 className="font-serif text-2xl">Answer by answer</h2>
            <p className="mt-1 text-sm text-muted-foreground">Open a question to see what you said and the feedback on it.</p>
            <div className="mt-5 space-y-3">
              {questions.map((q, i) => (
                <AnswerCard key={i} q={q} index={i} number={questions.slice(0, i + 1).filter(x => !x.is_intro).length} open={openIndex === i} onToggle={() => setOpenIndex(openIndex === i ? null : i)} />
              ))}
            </div>
          </section>
        )}

        {/* 5. Optional detail */}
        {questions.length > 0 && (
          <details className="group rounded-2xl border border-border bg-surface">
            <summary className="cursor-pointer list-none px-5 py-4 flex items-center justify-between gap-3">
              <span><span className="font-medium">Detailed charts</span> <span className="text-sm text-muted-foreground">· confidence, pace, filler words, eye contact, posture</span></span>
              <ChevronDown className="w-4 h-4 shrink-0 text-muted-foreground transition group-open:rotate-180" />
            </summary>
            <div className="px-5 pb-5 space-y-4">
              <RadarChart breakdown={report.breakdown} />
              <ConfidenceTrendChart questions={questions} />
              {hasAudio && (<><WpmChart questions={questions} /><FillerWordChart questions={questions} /></>)}
              <EyeContactTimelineChart questions={questions} />
              <PostureChart questions={questions} />
              <FatigueChart questions={questions} />
              <AttentionArcSummary questions={questions} />
            </div>
          </details>
        )}

        {score >= 75 && !endedEarly && (
          <div className="rounded-2xl border border-primary/30 bg-primary/5 p-6 text-center">
            <Award className="w-8 h-8 text-primary mx-auto" />
            <p className="mt-2 font-serif text-2xl">Interview-ready</p>
            <p className="text-sm text-muted-foreground mt-1">You scored {score}/100 for {report.job_title ?? jobTitle}. Take a screenshot to share it.</p>
          </div>
        )}

        <div className="flex flex-wrap items-center justify-center gap-3 pt-2 no-print">
          <button onClick={handleDownloadPDF} disabled={pdfLoading}
            className="inline-flex items-center gap-2 border border-border hover:bg-secondary font-medium px-6 py-3 rounded-xl transition disabled:opacity-60">
            {pdfLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
            {pdfLoading ? "Preparing PDF..." : "Download PDF"}
          </button>
          <button onClick={onRestart}
            className="inline-flex items-center gap-2 bg-primary hover:bg-primary/90 text-primary-foreground font-medium px-6 py-3 rounded-xl transition glow-primary">
            <RotateCcw className="w-4 h-4" /> Practice again
          </button>
        </div>
      </main>
    </div>
  );
}

const AREA_HINTS: Record<string, string> = {
  technical_depth: "How well you knew the subject and explained the how and why.",
  problem_solving: "How you broke problems down and weighed the trade-offs.",
  communication_clarity: "How clear, structured and easy to follow your answers were.",
  confidence: "How assured you sounded: steady pace, few fillers, little hedging.",
  cultural_fit: "How your examples showed teamwork, ownership and values.",
};

function verdictFor(reco: string) {
  const v = reco.toUpperCase().replace(/[\s_]+/g, "_");
  if (v.includes("NO")) return { label: "Not yet", style: "bg-destructive/15 text-destructive", meaning: "On this showing you probably wouldn't reach the next round yet. The feedback below shows what to fix." };
  if (v.includes("HIRE")) return { label: "Likely to move forward", style: "bg-success/15 text-success", meaning: "An interviewer would likely put you through to the next round." };
  return { label: "Borderline", style: "bg-warning/15 text-warning", meaning: "It could go either way. Improving the areas below would tip it in your favour." };
}

function barColor(outOfTen: number) {
  return outOfTen >= 7 ? "bg-success" : outOfTen >= 5 ? "bg-primary" : "bg-destructive";
}

function Fact({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-xl border border-border bg-background/40 px-3 py-2.5">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 font-medium">{value}</dd>
      {hint && <dd className="text-[11px] text-muted-foreground">{hint}</dd>}
    </div>
  );
}

function AnswerCard({ q, index, number, open, onToggle }: { q: QuestionScore; index: number; number: number; open: boolean; onToggle: () => void }) {
  const transcript = q.answer_text ?? q.answer_transcript ?? "";
  const fillerWords = q.audio_signals?.filler_words_found ?? [];
  const scores = [q.content_score, q.communication_score, q.confidence_score].filter((x): x is number => typeof x === "number");
  const avgScore = scores.length ? Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 10) / 10 : null;
  const label = q.is_intro ? "Introduction" : `Question ${number}`;
  return (
    <div className="rounded-2xl border border-border bg-surface overflow-hidden">
      <button onClick={onToggle} className="w-full text-left px-5 py-4 flex items-start gap-4 hover:bg-secondary/40 transition">
        <div className="flex-1 min-w-0">
          <div className="text-xs text-muted-foreground">{label}{q.category ? ` · ${prettyLabel(q.category)}` : ""}</div>
          <div className={`mt-1 font-medium ${open ? "" : "line-clamp-2"}`}>{q.question_text ?? q.question}</div>
        </div>
        {q.anomaly_reason === "no_speech_detected"
          ? <span className="shrink-0 text-xs px-2 py-1 rounded-full bg-warning/15 text-warning">No answer</span>
          : avgScore != null && (
            <span className={`shrink-0 font-serif text-xl ${avgScore >= 7 ? "text-success" : avgScore >= 5 ? "text-primary" : "text-destructive"}`}>
              {avgScore}<span className="text-xs text-muted-foreground">/10</span>
            </span>
          )}
        <ChevronDown className={`w-4 h-4 mt-1 shrink-0 text-muted-foreground transition ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div className="px-5 pb-5 space-y-4">
          <div>
            <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">What you said</div>
            {transcript ? (
              <div className="text-sm leading-relaxed bg-background/50 border border-border rounded-xl p-4 whitespace-pre-wrap">
                {fillerWords.length > 0 ? highlightFillers(transcript, fillerWords) : transcript}
                {fillerWords.length > 0 && <div className="mt-2 pt-2 border-t border-border/50"><FillerCount q={q} /></div>}
              </div>
            ) : <p className="text-sm text-muted-foreground italic">No speech was detected in this recording.</p>}
          </div>
          {q.justification && (
            <div>
              <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">Feedback</div>
              <p className="text-sm leading-relaxed">{q.justification}</p>
            </div>
          )}
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 text-xs">
            <Metric label="Content" value={q.content_score} />
            <Metric label="Communication" value={q.communication_score} />
            <Metric label="Confidence" value={q.confidence_score} />
            <Metric label="Pace (wpm)" value={q.wpm ?? q.audio_signals?.words_per_minute} raw />
            <Metric label="Eye contact" value={q.video_signals?.video_available === false ? undefined : (q.eye_contact_pct ?? q.video_signals?.eye_contact_percentage)} suffix="%" raw />
          </div>
          <BodyLanguageCard q={q} index={index} />
        </div>
      )}
    </div>
  );
}

function ListCard({
  title,
  items,
  icon,
  borderClass,
}: {
  title: string;
  items: string[];
  icon: ReactNode;
  borderClass: string;
}) {
  return (
    <div className="bg-surface border border-border rounded-2xl p-6">
      <div className="flex items-center gap-2 mb-3">
        {icon}
        <h3 className="font-medium">{title}</h3>
      </div>
      {items && items.length > 0 ? (
        <ul className="space-y-2">
          {items.map((t, i) => (
            <li key={i} className={`text-sm pl-3 ${borderClass}`}>{t}</li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">None noted.</p>
      )}
    </div>
  );
}

function Metric({ label, value, suffix = "", raw = false }: { label: string; value?: number; suffix?: string; raw?: boolean }) {
  if (value == null) return (
    <div className="bg-background/40 border border-border rounded-lg px-2 py-2 text-center">
      <div className="text-muted-foreground">{label}</div>
      <div className="text-foreground/60 mt-1">—</div>
    </div>
  );
  const display = Math.round(value);
  const colorClass = !raw ? scoreColor(display * 10).split(" ")[0] : "text-foreground";
  return (
    <div className="bg-background/40 border border-border rounded-lg px-2 py-2 text-center">
      <div className="text-muted-foreground">{label}</div>
      <div className={`mt-1 font-medium ${colorClass}`}>{display}{suffix}</div>
    </div>
  );
}

// Safelist anchor — these full class strings must exist so Tailwind v4 generates them at build time
// border-success/40 border-destructive/40 border-warning/40
// bg-success text-success-foreground bg-destructive text-destructive-foreground bg-warning text-warning-foreground 