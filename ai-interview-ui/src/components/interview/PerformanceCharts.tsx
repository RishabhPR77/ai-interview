import type { QuestionScore } from "@/lib/interview-api";

const DARK = {
  grid: "#21332f",
  axis: "#2f4641",
  text: "#93a8a1",
  fill: "rgba(45,212,167,0.16)",
  stroke: "#2dd4a7",
  green: "#4ade9e",
  yellow: "#f5b971",
  red: "#f2726f",
  blue: "#4cc3e0",
  muted: "#5f756e",
};

function scoreToColor(v: number, max = 10): string {
  const pct = v / max;
  if (pct >= 0.75) return DARK.green;
  if (pct >= 0.5) return DARK.yellow;
  return DARK.red;
}

function wpmColor(wpm: number): string {
  if (wpm >= 120 && wpm <= 160) return DARK.green;
  if (wpm >= 90 && wpm < 120) return DARK.yellow;
  if (wpm > 160 && wpm <= 190) return DARK.yellow;
  return DARK.red;
}

function fillerColor(count: number): string {
  if (count <= 2) return DARK.green;
  if (count <= 5) return DARK.yellow;
  return DARK.red;
}

/* ─── Radar / Spider Chart ─────────────────────────────────── */

interface RadarProps {
  breakdown: Record<string, number>;
}

const RADAR_LABELS: Record<string, string> = {
  technical_depth: "Technical",
  problem_solving: "Problem\nSolving",
  communication_clarity: "Comms",
  confidence: "Confidence",
  cultural_fit: "Culture",
};

export function RadarChart({ breakdown }: RadarProps) {
  const keys = ["technical_depth", "problem_solving", "communication_clarity", "confidence", "cultural_fit"];
  const cx = 160;
  const cy = 160;
  const R = 110;
  const n = keys.length;

  function angleOf(i: number) {
    return (Math.PI * 2 * i) / n - Math.PI / 2;
  }

  function pt(i: number, r: number) {
    const a = angleOf(i);
    return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) };
  }

  const gridLevels = [0.25, 0.5, 0.75, 1];

  const dataPoints = keys.map((k, i) => {
    const val = (breakdown[k] ?? 0) / 10;
    return pt(i, val * R);
  });

  const polyPath = dataPoints.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ") + " Z";

  return (
    <div className="bg-surface border border-border rounded-2xl p-6">
      <h3 className="font-medium mb-4">Skill Radar</h3>
      <div className="flex items-center justify-center">
        <svg viewBox="0 0 320 320" width="260" height="260">
          {/* Grid rings */}
          {gridLevels.map((lvl) => {
            const ringPts = keys.map((_, i) => pt(i, lvl * R));
            const d = ringPts.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ") + " Z";
            return <path key={lvl} d={d} fill="none" stroke={DARK.grid} strokeWidth="1" />;
          })}

          {/* Axis lines */}
          {keys.map((_, i) => {
            const end = pt(i, R);
            return <line key={i} x1={cx} y1={cy} x2={end.x} y2={end.y} stroke={DARK.axis} strokeWidth="1" />;
          })}

          {/* Data polygon */}
          <path d={polyPath} fill={DARK.fill} stroke={DARK.stroke} strokeWidth="2" strokeLinejoin="round" />

          {/* Data dots */}
          {dataPoints.map((p, i) => (
            <circle key={i} cx={p.x} cy={p.y} r="4" fill={DARK.stroke} />
          ))}

          {/* Labels */}
          {keys.map((k, i) => {
            const angle = angleOf(i);
            const labelR = R + 26;
            const lx = cx + labelR * Math.cos(angle);
            const ly = cy + labelR * Math.sin(angle);
            const label = RADAR_LABELS[k] || k;
            const lines = label.split("\n");
            const score = Math.round(breakdown[k] ?? 0);
            return (
              <g key={k}>
                {lines.map((line, li) => (
                  <text
                    key={li}
                    x={lx}
                    y={ly + li * 13 - (lines.length - 1) * 6}
                    textAnchor="middle"
                    dominantBaseline="middle"
                    fontSize="11"
                    fill={DARK.text}
                    fontFamily="sans-serif"
                  >
                    {line}
                  </text>
                ))}
                <text
                  x={lx}
                  y={ly + lines.length * 13 - (lines.length - 1) * 6}
                  textAnchor="middle"
                  dominantBaseline="middle"
                  fontSize="12"
                  fontWeight="bold"
                  fill={scoreToColor(breakdown[k] ?? 0)}
                  fontFamily="sans-serif"
                >
                  {score}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
}

/* ─── Line Chart (Confidence + Content trend) ───────────────── */

interface TrendProps {
  questions: QuestionScore[];
}

export function ConfidenceTrendChart({ questions }: TrendProps) {
  if (!questions.length) return null;

  const W = 500;
  const H = 160;
  const padL = 32;
  const padR = 16;
  const padT = 16;
  const padB = 32;
  const chartW = W - padL - padR;
  const chartH = H - padT - padB;
  const n = questions.length;

  function xOf(i: number) {
    return padL + (n === 1 ? chartW / 2 : (i / (n - 1)) * chartW);
  }
  function yOf(v: number) {
    return padT + chartH - (v / 10) * chartH;
  }

  const confidencePoints = questions.map((q, i) => ({ x: xOf(i), y: yOf(q.confidence_score ?? 0) }));
  const contentPoints = questions.map((q, i) => ({ x: xOf(i), y: yOf(q.content_score ?? 0) }));

  function polyline(pts: { x: number; y: number }[]) {
    return pts.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
  }

  const yGridLines = [0, 2, 4, 6, 8, 10];

  return (
    <div className="bg-surface border border-border rounded-2xl p-6">
      <div className="flex items-center gap-4 mb-4">
        <h3 className="font-medium">Score Trend</h3>
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <span className="flex items-center gap-1"><span style={{ background: DARK.stroke }} className="inline-block w-3 h-0.5 rounded" /> Confidence</span>
          <span className="flex items-center gap-1"><span style={{ background: DARK.blue }} className="inline-block w-3 h-0.5 rounded" /> Content</span>
        </div>
      </div>
      <div className="overflow-x-auto">
        <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ minWidth: 280 }}>
          {/* Grid lines */}
          {yGridLines.map((v) => (
            <g key={v}>
              <line x1={padL} y1={yOf(v)} x2={W - padR} y2={yOf(v)} stroke={DARK.grid} strokeWidth="1" />
              <text x={padL - 6} y={yOf(v)} textAnchor="end" dominantBaseline="middle" fontSize="10" fill={DARK.text} fontFamily="sans-serif">
                {v}
              </text>
            </g>
          ))}

          {/* Lines */}
          <path d={polyline(contentPoints)} fill="none" stroke={DARK.blue} strokeWidth="2" strokeLinejoin="round" />
          <path d={polyline(confidencePoints)} fill="none" stroke={DARK.stroke} strokeWidth="2" strokeLinejoin="round" />

          {/* Dots + Q labels */}
          {questions.map((q, i) => (
            <g key={i}>
              <circle cx={xOf(i)} cy={yOf(q.content_score ?? 0)} r="3.5" fill={DARK.blue} />
              <circle cx={xOf(i)} cy={yOf(q.confidence_score ?? 0)} r="3.5" fill={DARK.stroke} />
              <text x={xOf(i)} y={H - 6} textAnchor="middle" fontSize="10" fill={DARK.text} fontFamily="sans-serif">
                Q{i + 1}
              </text>
            </g>
          ))}
        </svg>
      </div>
    </div>
  );
}

/* ─── Bar Chart — reusable ──────────────────────────────────── */

interface BarProps {
  title: string;
  questions: QuestionScore[];
  getValue: (q: QuestionScore) => number;
  getColor: (v: number) => string;
  maxValue: number;
  yLabel: string;
  normalZone?: [number, number];
}

function BarChart({ title, questions, getValue, getColor, maxValue, yLabel, normalZone }: BarProps) {
  if (!questions.length) return null;

  const W = 500;
  const H = 160;
  const padL = 36;
  const padR = 16;
  const padT = 16;
  const padB = 32;
  const chartW = W - padL - padR;
  const chartH = H - padT - padB;
  const n = questions.length;
  const barW = Math.max(10, (chartW / n) * 0.6);
  const gap = chartW / n;

  function xOf(i: number) {
    return padL + gap * i + gap / 2;
  }
  function barH(v: number) {
    return (Math.min(v, maxValue) / maxValue) * chartH;
  }

  const yTicks = [0, Math.round(maxValue * 0.25), Math.round(maxValue * 0.5), Math.round(maxValue * 0.75), maxValue];

  return (
    <div className="bg-surface border border-border rounded-2xl p-6">
      <h3 className="font-medium mb-4">{title}</h3>
      <div className="overflow-x-auto">
        <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ minWidth: 280 }}>
          {/* Normal zone band */}
          {normalZone && (
            <rect
              x={padL}
              y={padT + chartH - (normalZone[1] / maxValue) * chartH}
              width={chartW}
              height={((normalZone[1] - normalZone[0]) / maxValue) * chartH}
              fill="rgba(74,222,158,0.08)"
            />
          )}

          {/* Grid lines */}
          {yTicks.map((v) => {
            const y = padT + chartH - (v / maxValue) * chartH;
            return (
              <g key={v}>
                <line x1={padL} y1={y} x2={W - padR} y2={y} stroke={DARK.grid} strokeWidth="1" />
                <text x={padL - 6} y={y} textAnchor="end" dominantBaseline="middle" fontSize="10" fill={DARK.text} fontFamily="sans-serif">
                  {v}
                </text>
              </g>
            );
          })}

          {/* Bars */}
          {questions.map((q, i) => {
            const val = getValue(q);
            const h = barH(val);
            const color = getColor(val);
            const x = xOf(i);
            const y = padT + chartH - h;
            return (
              <g key={i}>
                <rect x={x - barW / 2} y={y} width={barW} height={h} rx="3" fill={color} fillOpacity="0.85" />
                <text x={x} y={y - 5} textAnchor="middle" fontSize="10" fill={color} fontFamily="sans-serif" fontWeight="bold">
                  {Math.round(val)}
                </text>
                <text x={x} y={H - 6} textAnchor="middle" fontSize="10" fill={DARK.text} fontFamily="sans-serif">
                  Q{i + 1}
                </text>
              </g>
            );
          })}

          {/* Y label */}
          <text
            x={10}
            y={padT + chartH / 2}
            textAnchor="middle"
            fontSize="10"
            fill={DARK.muted}
            fontFamily="sans-serif"
            transform={`rotate(-90, 10, ${padT + chartH / 2})`}
          >
            {yLabel}
          </text>
        </svg>
      </div>
    </div>
  );
}

/* ─── WPM Chart ─────────────────────────────────────────────── */
export function WpmChart({ questions }: TrendProps) {
  return (
    <BarChart
      title="Words Per Minute per Question"
      questions={questions}
      getValue={(q) => q.wpm ?? q.audio_signals?.words_per_minute ?? 0}
      getColor={wpmColor}
      maxValue={250}
      yLabel="WPM"
      normalZone={[120, 160]}
    />
  );
}

/* ─── Filler Words Chart ────────────────────────────────────── */
export function FillerWordChart({ questions }: TrendProps) {
  return (
    <BarChart
      title="Filler Words per Question"
      questions={questions}
      getValue={(q) => q.audio_signals?.filler_word_count ?? 0}
      getColor={fillerColor}
      maxValue={20}
      yLabel="Count"
    />
  );
}

/* ─── Eye Contact Timeline Chart ────────────────────────────── */
interface EyeContactProps {
  questions: QuestionScore[];
}

export function EyeContactTimelineChart({ questions }: EyeContactProps) {
  // Skip answers with no usable video (camera off / analysis failed) — 0% would be misleading.
  const data = questions.filter(q => q.video_signals?.look_away_events?.length != null && q.video_signals?.video_available !== false);
  if (!data.length) return null;

  return (
    <div className="bg-surface border border-border rounded-2xl p-6">
      <h3 className="font-medium mb-1">Eye Contact % per Question</h3>
      <p className="text-xs text-muted-foreground mb-4">Green band = 70–100% (ideal range)</p>
      <BarChart
        title=""
        questions={data}
        getValue={(q) => q.video_signals?.eye_contact_percentage ?? q.eye_contact_pct ?? 0}
        getColor={(v) => v >= 70 ? DARK.green : v >= 45 ? DARK.yellow : DARK.red}
        maxValue={100}
        yLabel="%"
        normalZone={[70, 100]}
      />
    </div>
  );
}

/* ─── Posture Score per Question ─────────────────────────────── */
export function PostureChart({ questions }: TrendProps) {
  const hasPosture = questions.some(q => q.video_signals?.posture_score != null);
  if (!hasPosture) return null;

  return (
    <BarChart
      title="Posture Score per Question"
      questions={questions}
      getValue={(q) => q.video_signals?.posture_score ?? 0}
      getColor={(v) => v >= 7 ? DARK.green : v >= 5 ? DARK.yellow : DARK.red}
      maxValue={10}
      yLabel="Score"
      normalZone={[7, 10]}
    />
  );
}

/* ─── Fatigue / Drowsiness per Question ──────────────────────── */
export function FatigueChart({ questions }: TrendProps) {
  const hasData = questions.some(q => q.video_signals?.drowsiness_score != null);
  if (!hasData) return null;

  return (
    <BarChart
      title="Drowsiness Score per Question"
      questions={questions}
      getValue={(q) => q.video_signals?.drowsiness_score ?? 0}
      getColor={(v) => v <= 2 ? DARK.green : v <= 5 ? DARK.yellow : DARK.red}
      maxValue={10}
      yLabel="Score"
    />
  );
}

/* ─── Attention Arc Summary ──────────────────────────────────── */
interface AttentionArcProps {
  questions: QuestionScore[];
}

const ARC_LABEL: Record<string, { label: string; color: string; desc: string }> = {
  consistent:  { label: "Consistent",  color: DARK.green,  desc: "Eye contact steady throughout" },
  improving:   { label: "Improving",   color: DARK.blue,   desc: "Started distracted, improved by end" },
  degrading:   { label: "Degrading",   color: DARK.yellow, desc: "Started attentive, lost focus near end" },
  unknown:     { label: "Unknown",     color: DARK.muted,  desc: "Insufficient data" },
};

export function AttentionArcSummary({ questions }: AttentionArcProps) {
  const withArc = questions.filter(q => q.video_signals?.attention_arc && q.video_signals.attention_arc !== "unknown");
  if (!withArc.length) return null;

  return (
    <div className="bg-surface border border-border rounded-2xl p-6">
      <h3 className="font-medium mb-4">Attention Arc per Question</h3>
      <div className="space-y-2">
        {withArc.map((q, i) => {
          const arc = q.video_signals?.attention_arc ?? "unknown";
          const info = ARC_LABEL[arc] ?? ARC_LABEL.unknown;
          return (
            <div key={i} className="flex items-center gap-3 text-sm">
              <span className="text-muted-foreground w-8 shrink-0">Q{i + 1}</span>
              <span
                className="inline-block w-2.5 h-2.5 rounded-full shrink-0"
                style={{ background: info.color }}
              />
              <span style={{ color: info.color }} className="font-medium w-24 shrink-0">{info.label}</span>
              <span className="text-muted-foreground text-xs">{info.desc}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ─── Body Language Summary Card ─────────────────────────────── */
interface BodyLangProps {
  q: QuestionScore;
  index: number;
}

export function BodyLanguageCard({ q, index }: BodyLangProps) {
  const vs = q.video_signals;
  if (!vs) return null;

  const items: { label: string; value: string; color: string }[] = [];

  if (vs.dominant_position && vs.dominant_position !== "unknown") {
    const posLabel = vs.dominant_position.replace(/_/g, " ");
    const posColor = vs.dominant_position === "upright" ? DARK.green : DARK.yellow;
    items.push({ label: "Position", value: posLabel, color: posColor });
  }

  if (vs.fatigue_trajectory && vs.fatigue_trajectory !== "none") {
    const fatColor = vs.fatigue_trajectory === "mild" ? DARK.yellow : DARK.red;
    items.push({ label: "Fatigue", value: vs.fatigue_trajectory, color: fatColor });
  }

  if (vs.yawn_count != null && vs.yawn_count > 0) {
    items.push({ label: "Yawns", value: `${vs.yawn_count}`, color: DARK.yellow });
  }

  if (vs.head_movement_pattern && vs.head_movement_pattern !== "unknown" && vs.head_movement_pattern !== "natural") {
    const hColor = vs.head_movement_pattern === "rigid" ? DARK.yellow : DARK.red;
    items.push({ label: "Head", value: vs.head_movement_pattern.replace(/_/g, " "), color: hColor });
  }

  if (vs.looking_down_pct != null && vs.looking_down_pct > 15) {
    items.push({ label: "Looking down", value: `${vs.looking_down_pct}%`, color: DARK.yellow });
  }

  if (vs.gesture_frequency != null && vs.gesture_frequency > 0.05) {
    const gLabel = vs.gesture_frequency > 0.4 ? "very frequent" : vs.gesture_frequency > 0.15 ? "moderate" : "light";
    items.push({ label: "Gestures", value: gLabel, color: DARK.green });
  }

  if (vs.glasses_detected) {
    items.push({ label: "Glasses", value: "detected (head-pose eye contact)", color: DARK.muted });
  }

  if (vs.look_away_events?.length) {
    const total = vs.look_away_events.reduce((s: number, e: any) => s + e.duration, 0);
    items.push({
      label: "Look-aways",
      value: `${vs.look_away_events.length}x (~${Math.round(total)}s total)`,
      color: total > 10 ? DARK.red : DARK.yellow,
    });
  }

  if (!items.length) return null;

  return (
    <div className="mt-3 pt-3 border-t border-border/50">
      <p className="text-xs text-muted-foreground mb-2 font-medium uppercase tracking-wider">Body Language</p>
      <div className="flex flex-wrap gap-2">
        {items.map((item, i) => (
          <span
            key={i}
            className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full border"
            style={{ color: item.color, borderColor: item.color + "40", background: item.color + "15" }}
          >
            <span className="font-medium">{item.label}:</span>
            <span>{item.value}</span>
          </span>
        ))}
      </div>
    </div>
  );
}