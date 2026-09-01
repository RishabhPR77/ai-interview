import { AlertTriangle, CheckCircle2, XCircle, RotateCcw, Download, Loader2, AlertOctagon, RefreshCw, Award, Briefcase } from "lucide-react";
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

function recoStyle(r: string) {
  const v = r.toUpperCase().replace(/[\s_]+/g, "_");
  if (v === "HIRE") return "bg-success text-success-foreground";
  if (v === "NO_HIRE") return "bg-destructive text-destructive-foreground";
  return "bg-warning text-warning-foreground";
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
  const circ = 2 * Math.PI * 70;
  const dash = (score / 100) * circ;
  const reco = (report.recommendation ?? "MAYBE").toString();
  const conf = report.recommendation_confidence;
  const confText =
    typeof conf === "number" ? `${Math.round(conf * (conf <= 1 ? 100 : 1))}% confidence` : conf ? `${conf} confidence` : null;

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
        <div className="max-w-5xl mx-auto px-4 h-14 flex items-center gap-3">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-primary/15 border border-primary/30 flex items-center justify-center">
              <Briefcase className="w-3.5 h-3.5 text-primary" />
            </div>
            <span className="font-serif text-base leading-none">tejaskrit</span>
          </div>
          <div className="h-4 w-px bg-border mx-1" />
          <span className="text-xs text-muted-foreground">AI Interview Practice</span>
          <span className="text-xs text-muted-foreground/50 mx-1">·</span>
          <span className="text-xs text-foreground font-medium">Performance Report</span>

          <div className="ml-auto">
            <button
              onClick={onRestart}
              className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-border bg-secondary hover:bg-secondary/70 text-foreground transition"
            >
              <RotateCcw className="w-3 h-3" /> Practice Again
            </button>
          </div>
        </div>
      </header>

      <div className="max-w-5xl mx-auto px-4 py-10 space-y-8">

        <div className="text-center">
          <p className="text-sm uppercase tracking-wider text-muted-foreground">Interview Report</p>
          <h1 className="font-serif text-4xl md:text-5xl mt-2">{report.candidate_name ?? candidateName}</h1>
          <p className="text-muted-foreground mt-1">{report.job_title ?? jobTitle}</p>
        </div>

        {endedEarly && (
          <div className="relative overflow-hidden rounded-2xl border border-warning/40 bg-warning/5">
            <div className="absolute top-0 left-0 right-0 h-0.5 bg-gradient-to-r from-warning/80 via-destructive/60 to-warning/30" />
            <div className="px-6 py-5 flex flex-col sm:flex-row items-start sm:items-center gap-4">
              <div className="shrink-0 w-12 h-12 rounded-xl bg-warning/15 border border-warning/30 flex items-center justify-center">
                <AlertOctagon className="w-6 h-6 text-warning" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex flex-wrap items-center gap-2 mb-1">
                  <span className="text-warning font-semibold text-sm tracking-wide">SESSION ENDED EARLY</span>
                  <span className="text-[10px] uppercase tracking-widest px-2 py-0.5 rounded-full bg-warning/20 text-warning border border-warning/30 font-bold">
                    Partial Data
                  </span>
                </div>
                <p className="text-sm text-foreground/80 leading-relaxed">
                  This report was generated from an <strong>incomplete interview session</strong>. Not all questions were answered,
                  so scores, strengths, and weaknesses below reflect only the responses that were recorded.
                  Results may not accurately represent overall performance.
                </p>
                <div className="mt-3 flex flex-wrap gap-4 text-xs text-muted-foreground">
                  <span className="flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-success inline-block" />
                    {report.per_question_scores?.length ?? 0} question{(report.per_question_scores?.length ?? 0) !== 1 ? 's' : ''} answered
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-destructive inline-block" />
                    Remaining questions skipped
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-warning inline-block" />
                    AI confidence reduced
                  </span>
                </div>
              </div>
              <button
                onClick={onRestart}
                className="shrink-0 flex items-center gap-2 text-xs font-medium px-4 py-2.5 rounded-xl bg-surface border border-border hover:bg-secondary transition whitespace-nowrap"
              >
                <RefreshCw className="w-3.5 h-3.5" /> Retake Interview
              </button>
            </div>
          </div>
        )}

        {/* Score + Reco */}
        <div className="bg-surface border border-border rounded-2xl p-8 flex flex-col md:flex-row items-center gap-8">
          <div className="relative w-48 h-48 shrink-0">
            <svg viewBox="0 0 160 160" className="w-full h-full -rotate-90">
              <circle cx="80" cy="80" r="70" stroke="currentColor" className="text-secondary" strokeWidth="12" fill="none" />
              <circle
                cx="80" cy="80" r="70"
                stroke="currentColor"
                className={scoreColor(score).split(" ")[0]}
                strokeWidth="12"
                fill="none"
                strokeDasharray={`${dash} ${circ}`}
                strokeLinecap="round"
              />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <span className="font-serif text-5xl">{score}</span>
              <span className="text-xs text-muted-foreground uppercase tracking-wider mt-1">Overall</span>
            </div>
          </div>
          <div className="flex-1 text-center md:text-left">
            <div className="flex flex-wrap items-center gap-3 justify-center md:justify-start mb-3">
              <span className={`px-4 py-1.5 rounded-full font-semibold text-sm ${recoStyle(reco)}`}>
                {reco.toUpperCase().replace("_", " ")}
              </span>
              {confText && <span className="text-sm text-muted-foreground">{confText}</span>}
            </div>
            <p className="text-foreground/90 leading-relaxed">{report.summary}</p>
          </div>
        </div>

        {/* Score Breakdown */}
        {report.breakdown && (
          <div>
            <h2 className="font-serif text-2xl mb-4">Score Breakdown</h2>
            <div className="grid lg:grid-cols-2 gap-6 items-start">
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {Object.entries(report.breakdown).map(([k, v]) => {
                  const s = Math.round(v);
                  const weight = report.rubric?.[k];
                  return (
                    <div key={k} className={`rounded-xl border p-4 ${scoreColor(s * 10)}`}>
                      <div className="text-xs uppercase tracking-wider opacity-80">{prettyLabel(k)}</div>
                      <div className="font-serif text-3xl mt-2">{s}</div>
                      <div className="text-xs mt-1 opacity-60">
                        /10{weight != null ? ` · weight ${weight}%` : ""}
                      </div>
                    </div>
                  );
                })}
              </div>
              <RadarChart breakdown={report.breakdown} />
            </div>
          </div>
        )}

        {/* Session-level body language callouts */}
        {(() => {
          const glassesDetected = questions.some(q => q.video_signals?.glasses_detected);
          const overallFatigue = questions.some(q =>
            q.video_signals?.fatigue_trajectory === 'moderate' || q.video_signals?.fatigue_trajectory === 'severe'
          );
          const totalYawns = questions.reduce((s, q) => s + (q.video_signals?.yawn_count ?? 0), 0);
          return (
            <div className="space-y-3">
              {glassesDetected && (
                <div className="flex items-start gap-3 px-4 py-3 rounded-xl border border-border bg-secondary text-sm text-muted-foreground">
                  <span>👓</span>
                  <span><strong className="text-foreground">Glasses detected</strong> — eye contact was measured using head-pose orientation. Scores are accurate but may be slightly lower than without glasses.</span>
                </div>
              )}
              {overallFatigue && (
                <div className="flex items-start gap-3 px-4 py-3 rounded-xl border border-warning/40 bg-warning/5 text-sm">
                  <span>😴</span>
                  <span className="text-warning"><strong>Fatigue detected</strong> — {totalYawns > 0 ? totalYawns + ' yawn(s) recorded.' : 'Drowsiness signs detected.'} Practice when well-rested.</span>
                </div>
              )}
            </div>
          );
        })()}

        {/* Strengths / Weaknesses */}
        <div className="grid md:grid-cols-2 gap-4">
          <ListCard
            title="Strengths"
            items={report.strengths}
            icon={<CheckCircle2 className="w-5 h-5 text-success" />}
            borderClass="border-l-2 border-success/40"
          />
          <ListCard
            title="Weaknesses"
            items={report.weaknesses}
            icon={<XCircle className="w-5 h-5 text-destructive" />}
            borderClass="border-l-2 border-destructive/40"
          />
        </div>

        {report.red_flags && report.red_flags.length > 0 && (
          <ListCard
            title="Red Flags"
            items={report.red_flags}
            icon={<AlertTriangle className="w-5 h-5 text-warning" />}
            borderClass="border-l-2 border-warning/40"
          />
        )}

        {/* Performance Analytics */}
        {questions.length > 0 && (
          <div>
            <h2 className="font-serif text-2xl mb-4">Performance Analytics</h2>
            <div className="space-y-4">
              <ConfidenceTrendChart questions={questions} />
              {hasAudio && (
                <>
                  <WpmChart questions={questions} />
                  <FillerWordChart questions={questions} />
                </>
              )}
              <EyeContactTimelineChart questions={questions} />
              <PostureChart questions={questions} />
              <FatigueChart questions={questions} />
              <AttentionArcSummary questions={questions} />
            </div>
          </div>
        )}

        {/* Full Transcript — skip intro question */}
        <div>
          <h2 className="font-serif text-2xl mb-4">Full Transcript</h2>
          <div className="space-y-4">
            {questions
              .map((q, i) => {
              const transcript = q.answer_text ?? q.answer_transcript ?? "";
              const fillerWords = q.audio_signals?.filler_words_found ?? [];
              return (
                <div key={i} className="bg-surface border border-border rounded-2xl p-6">
                  <div className="flex items-start justify-between gap-4 mb-3">
                    <div>
                      <span className="text-xs uppercase tracking-wider text-muted-foreground">
                        Question {i + 1}{q.category ? ` · ${prettyLabel(q.category)}` : ""}
                      </span>
                      <h3 className="font-serif text-xl mt-1">{q.question_text ?? q.question}</h3>
                    </div>
                    {q.anomaly_flagged && (
                      <span className="shrink-0 inline-flex items-center gap-1 text-xs px-2 py-1 rounded-full bg-warning/15 text-warning border border-warning/30">
                        <AlertTriangle className="w-3 h-3" />
                        {q.anomaly_reason === "no_speech_detected" ? "No Response" : "Anomaly"}
                      </span>
                    )}
                  </div>

                  {transcript ? (
                    <div className="text-sm text-foreground/85 bg-background/50 border border-border rounded-lg p-3 mb-3 leading-relaxed whitespace-pre-wrap">
                      {fillerWords.length > 0
                        ? highlightFillers(transcript, fillerWords)
                        : transcript}
                      {fillerWords.length > 0 && (
                        <div className="mt-2 pt-2 border-t border-border/50">
                          <FillerCount q={q} />
                          <span className="text-[10px] text-muted-foreground ml-2">
                            Highlighted words: {[...new Set(fillerWords.map(w => w.toLowerCase()))].join(", ")}
                          </span>
                        </div>
                      )}
                    </div>
                  ) : q.anomaly_reason === "no_speech_detected" ? (
                    <div className="text-sm text-muted-foreground bg-background/50 border border-border rounded-lg p-3 mb-3 italic">
                      No speech was detected in this recording.
                    </div>
                  ) : null}

                  <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 text-xs">
                    <Metric label="Content" value={q.content_score} />
                    <Metric label="Comms" value={q.communication_score} />
                    <Metric label="Confidence" value={q.confidence_score} />
                    <Metric label="WPM" value={q.wpm ?? q.audio_signals?.words_per_minute} raw />
                    <Metric label="Eye contact" value={q.eye_contact_pct ?? q.video_signals?.eye_contact_percentage} suffix="%" raw />
                  </div>

                  {q.justification && (
                    <p className="text-sm text-muted-foreground mt-3 italic">{q.justification}</p>
                  )}
                  <BodyLanguageCard q={q} index={i} />
                </div>
              );
            })}
          </div>
        </div>

        {/* Certificate of completion */}
        {score >= 75 && !endedEarly && (
          <div className="relative overflow-hidden rounded-2xl border-2 border-primary/30 bg-gradient-to-br from-primary/5 via-success/5 to-primary/5 p-8 text-center space-y-4">
            <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-primary/60 via-success/60 to-primary/60" />
            <div className="absolute bottom-0 left-0 right-0 h-1 bg-gradient-to-r from-primary/60 via-success/60 to-primary/60" />
            <div className="text-xs uppercase tracking-[0.25em] text-primary font-semibold">Certificate of Completion</div>
            <div className="w-16 h-16 mx-auto rounded-full bg-success/15 border-2 border-success/40 flex items-center justify-center">
              <Award className="w-8 h-8 text-success" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">This certifies that</p>
              <h2 className="font-serif text-4xl mt-1">{report.candidate_name ?? candidateName}</h2>
            </div>
            <p className="text-muted-foreground text-sm">
              has successfully completed the AI mock interview for
            </p>
            <p className="font-semibold text-lg">{report.job_title ?? jobTitle}</p>
            <div className="flex items-end justify-center gap-1 py-1">
              <span className="font-serif text-6xl text-success">{score}</span>
              <span className="text-muted-foreground text-lg mb-2">/100</span>
            </div>
            <div className="text-xs text-muted-foreground space-y-1">
              <p>{new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}</p>
              <p className="opacity-50">Powered by Tejaskrit AI · Take a screenshot to share</p>
            </div>
          </div>
        )}

        {/* Action buttons */}
        <div className="flex items-center justify-center gap-4 pt-4 no-print">
          <button
            onClick={handleDownloadPDF}
            disabled={pdfLoading}
            className="inline-flex items-center gap-2 bg-surface hover:bg-secondary border border-border text-foreground font-medium px-6 py-3 rounded-lg transition disabled:opacity-60"
          >
            {pdfLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
            {pdfLoading ? "Generating PDF..." : "Download PDF"}
          </button>
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