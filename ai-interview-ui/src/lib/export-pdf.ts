import type { ReportResponse } from './interview-api'

function prettyLabel(k: string) {
  return k.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}

const BG      : [number, number, number] = [10,  10,  18]
const SURFACE : [number, number, number] = [22,  20,  36]
const SURFACE2: [number, number, number] = [30,  28,  48]
const PRIMARY : [number, number, number] = [140, 100, 240]
const SUCCESS : [number, number, number] = [60,  200, 120]
const WARNING : [number, number, number] = [230, 160,  40]
const DANGER  : [number, number, number] = [210,  70,  70]
const TEXT1   : [number, number, number] = [240, 238, 252]
const TEXT2   : [number, number, number] = [170, 165, 200]
const TEXT3   : [number, number, number] = [110, 105, 140]
const DIVIDER : [number, number, number] = [45,  42,  68]

export async function downloadReportPDF(report: ReportResponse, candidateName: string, jobTitle: string) {
  const { jsPDF } = await import('jspdf')
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })

  const PW = 210
  const PH = 297
  const M  = 16
  const CW = PW - M * 2
  let y = 0

  // Helper: get the actual line height in mm for the current font size.
  // jsPDF's default lineHeightFactor is ~1.15, so the true line height for a
  // single text line is fontSize * lineHeightFactor / (72/25.4) (converted
  // from points to mm).  Using this everywhere guarantees boxes sized with
  // doc.roundedRect fully contain the text with no clipping/overlap.
  function lineHeight() {
    const sizePt = doc.getFontSize()
    const lhf = doc.getLineHeightFactor()
    return sizePt * lhf * (25.4 / 72)  // points -> mm
  }

  function fillBg() {
    doc.setFillColor(...BG)
    doc.rect(0, 0, PW, PH, 'F')
  }

  function newPage() {
    doc.addPage()
    fillBg()
    y = M + 4
  }

  function checkPage(needed = 12) {
    if (y + needed > PH - 14) newPage()
  }

  function gap(h = 4) { y += h }

  function rule(color: [number, number, number] = DIVIDER, lw = 0.3) {
    checkPage(6)
    doc.setDrawColor(...color)
    doc.setLineWidth(lw)
    doc.line(M, y, PW - M, y)
    y += 5
  }

  function sectionTitle(text: string) {
    checkPage(14)
    gap(4)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(11)
    doc.setTextColor(...PRIMARY)
    doc.text(text.toUpperCase(), M, y)
    y += 2
    doc.setDrawColor(...PRIMARY)
    doc.setLineWidth(0.5)
    doc.line(M, y, M + doc.getTextWidth(text.toUpperCase()) + 2, y)
    y += 6
  }

  function bodyText(text: string, color: [number, number, number] = TEXT2, size = 8.5) {
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(size)
    doc.setTextColor(...color)
    const lines: string[] = doc.splitTextToSize(text, CW)
    const lh = lineHeight()
    checkPage(lines.length * lh + 3)
    doc.text(lines, M, y)
    y += lines.length * lh + 2
  }

  // ── Page 1 — Cover ──────────────────────────────────────────────────────

  fillBg()

  doc.setFillColor(...PRIMARY)
  doc.rect(0, 0, PW, 2, 'F')

  y = 28

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(7.5)
  doc.setTextColor(...TEXT3)
  doc.text('TEJASKRIT AI  ·  INTERVIEW PRACTICE', PW / 2, y, { align: 'center' })
  y += 5

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8)
  doc.setTextColor(...TEXT3)
  doc.text('PERFORMANCE REPORT', PW / 2, y, { align: 'center' })
  y += 10

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(26)
  doc.setTextColor(...TEXT1)
  doc.text(report.candidate_name ?? candidateName, PW / 2, y, { align: 'center' })
  y += 7

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(10)
  doc.setTextColor(...PRIMARY)
  doc.text(report.job_title ?? jobTitle, PW / 2, y, { align: 'center' })
  y += 12

  rule([...DIVIDER] as [number, number, number])
  gap(2)

  // ── Score + Recommendation row ──────────────────────────────────────────

  const score = Math.round(report.overall_score ?? 0)
  const scoreColor: [number, number, number] = score >= 75 ? SUCCESS : score >= 50 ? WARNING : DANGER

  const circX = M
  const circW = 48
  const circH = 42
  doc.setFillColor(...SURFACE)
  doc.roundedRect(circX, y, circW, circH, 4, 4, 'F')
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(30)
  doc.setTextColor(...scoreColor)
  doc.text(String(score), circX + circW / 2, y + 20, { align: 'center' })
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(6.5)
  doc.setTextColor(...TEXT3)
  doc.text('OVERALL', circX + circW / 2, y + 28, { align: 'center' })
  doc.setFontSize(6)
  doc.setTextColor(...TEXT3)
  doc.text('out of 100', circX + circW / 2, y + 33, { align: 'center' })

  const recoX = M + circW + 6
  const recoW = CW - circW - 6

  const reco = (report.recommendation ?? 'MAYBE').toUpperCase().replace(/[\s_]+/g, ' ')
  const recoFill: [number, number, number] = reco.includes('NO') ? DANGER : reco === 'HIRE' ? SUCCESS : WARNING

  doc.setFillColor(...recoFill)
  doc.roundedRect(recoX, y + 1, 38, 10, 3, 3, 'F')
  doc.setDrawColor(...recoFill)
  doc.setLineWidth(0.6)
  doc.roundedRect(recoX, y + 1, 38, 10, 3, 3, 'S')

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(8.5)
  doc.setTextColor(255, 255, 255)
  doc.text(reco, recoX + 19, y + 8, { align: 'center' })

  const conf = report.recommendation_confidence
  const confText = typeof conf === 'number'
    ? `${Math.round(conf * (conf <= 1 ? 100 : 1))}% confidence`
    : conf ? `${conf} confidence` : ''
  if (confText) {
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(7.5)
    doc.setTextColor(...TEXT2)
    doc.text(confText, recoX + 42, y + 8)
  }

  if (report.summary) {
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8)
    doc.setTextColor(...TEXT2)
    const summaryLines: string[] = doc.splitTextToSize(report.summary, recoW - 2)
    const summaryStartY = y + 14
    doc.text(summaryLines, recoX, summaryStartY)
    const lh = doc.getFontSize() * doc.getLineHeightFactor() * (25.4 / 72)
    const summaryH = summaryLines.length * lh
    const totalH = Math.max(circH + 4, summaryH + 18)
    y += totalH
  } else {
    y += circH + 6
  }

  gap(4)
  rule()

  // ── Score Breakdown — FIX: show weight next to each score ───────────────

  sectionTitle('Score Breakdown')

  if (report.breakdown) {
    const entries = Object.entries(report.breakdown)
    const cols = Math.min(entries.length, 3)
    const cardW = (CW - (cols - 1) * 3) / cols
    const cardH = 26  // slightly taller to fit weight label

    entries.forEach(([k, v], i) => {
      const col = i % cols
      const row = Math.floor(i / cols)
      if (col === 0 && row > 0) checkPage(cardH + 4)
      const bx = M + col * (cardW + 3)
      const by = y + row * (cardH + 3)

      const sv = Math.round(v)
      const sc: [number, number, number] = sv >= 7 ? SUCCESS : sv >= 5 ? WARNING : DANGER
      const weight = report.rubric?.[k]

      doc.setFillColor(...SURFACE)
      doc.roundedRect(bx, by, cardW, cardH, 3, 3, 'F')

      // Score bar background
      doc.setFillColor(...SURFACE2)
      doc.roundedRect(bx + 2, by + cardH - 5, cardW - 4, 3, 1, 1, 'F')
      // Score bar fill
      doc.setFillColor(...sc)
      const barFill = Math.max(2, ((sv / 10) * (cardW - 4)))
      doc.roundedRect(bx + 2, by + cardH - 5, barFill, 3, 1, 1, 'F')

      // Score number
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(16)
      doc.setTextColor(...sc)
      doc.text(String(sv), bx + 6, by + 13)

      // "/10" suffix
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(7)
      doc.setTextColor(...TEXT3)
      doc.text('/10', bx + 6 + doc.getTextWidth(String(sv)) + 1, by + 13)

      // Category label
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(6.5)
      doc.setTextColor(...TEXT3)
      doc.text(prettyLabel(k).toUpperCase(), bx + 6, by + 18)

      // Weight label — FIX: show rubric weight
      if (weight != null) {
        doc.setFont('helvetica', 'normal')
        doc.setFontSize(6)
        doc.setTextColor(...TEXT3)
        doc.text(`weight ${weight}%`, bx + 6, by + 22)
      }
    })

    y += Math.ceil(entries.length / cols) * (cardH + 3) + 2
  }

  gap(4)
  rule()

  // ── Strengths ───────────────────────────────────────────────────────────

  sectionTitle('Strengths')
  ;(report.strengths ?? []).forEach((s, i) => {
    checkPage(14)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8)
    const lh = lineHeight()
    const lines: string[] = doc.splitTextToSize(s, CW - 12)
    const boxH = Math.max(10, lines.length * lh + 3)
    doc.setFillColor(18, 38, 26)
    doc.roundedRect(M, y, CW, boxH, 2, 2, 'F')
    doc.setDrawColor(...SUCCESS)
    doc.setLineWidth(0.5)
    doc.line(M, y, M, y + boxH)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8)
    doc.setTextColor(...SUCCESS)
    doc.text(`${i + 1}.`, M + 3, y + lh + 1.5)
    doc.setTextColor(...TEXT1)
    doc.text(lines, M + 10, y + lh + 1.5)
    y += boxH + 3
  })

  gap(4)
  rule()

  // ── Weaknesses ──────────────────────────────────────────────────────────

  sectionTitle('Weaknesses')
  ;(report.weaknesses ?? []).forEach((s, i) => {
    checkPage(14)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8)
    const lh = lineHeight()
    const lines: string[] = doc.splitTextToSize(s, CW - 12)
    const boxH = Math.max(10, lines.length * lh + 3)
    doc.setFillColor(38, 18, 18)
    doc.roundedRect(M, y, CW, boxH, 2, 2, 'F')
    doc.setDrawColor(...DANGER)
    doc.setLineWidth(0.5)
    doc.line(M, y, M, y + boxH)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8)
    doc.setTextColor(...DANGER)
    doc.text(`${i + 1}.`, M + 3, y + lh + 1.5)
    doc.setTextColor(...TEXT1)
    doc.text(lines, M + 10, y + lh + 1.5)
    y += boxH + 3
  })

  if (report.red_flags && report.red_flags.length > 0) {
    gap(4)
    rule()
    sectionTitle('Red Flags')
    report.red_flags.forEach((s) => {
      checkPage(12)
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(8)
      doc.setTextColor(...WARNING)
      const lines: string[] = doc.splitTextToSize(`⚠  ${s}`, CW - 4)
      doc.text(lines, M + 2, y)
      y += lines.length * lineHeight() + 3
    })
  }

  gap(4)
  rule()

  // ── Body Language Overview — session-level callouts (glasses, fatigue) ──

  const allQuestions = report.per_question_scores ?? []
  const glassesDetected = allQuestions.some(q => q.video_signals?.glasses_detected)
  const overallFatigue = allQuestions.some(q =>
    q.video_signals?.fatigue_trajectory === 'moderate' || q.video_signals?.fatigue_trajectory === 'severe'
  )
  const totalYawns = allQuestions.reduce((s, q) => s + (q.video_signals?.yawn_count ?? 0), 0)
  const avgGesture = (() => {
    const vals = allQuestions.map(q => q.video_signals?.gesture_frequency).filter((v): v is number => v != null)
    return vals.length ? vals.reduce((s, v) => s + v, 0) / vals.length : null
  })()

  if (glassesDetected || overallFatigue || avgGesture != null) {
    sectionTitle('Body Language Overview')

    if (glassesDetected) {
      checkPage(10)
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(8)
      doc.setTextColor(...TEXT2)
      const lines: string[] = doc.splitTextToSize(
        'Glasses detected — eye contact was measured using head-pose orientation instead of iris tracking for some questions.',
        CW - 4
      )
      doc.text(lines, M + 2, y)
      y += lines.length * lineHeight() + 2
    }

    if (overallFatigue) {
      checkPage(10)
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(8)
      doc.setTextColor(...WARNING)
      const fatigueMsg = totalYawns > 0
        ? `Fatigue detected — ${totalYawns} yawn(s) recorded across answers. Consider practicing when well-rested.`
        : 'Fatigue detected — signs of drowsiness were observed in body language during some answers.'
      const lines: string[] = doc.splitTextToSize(fatigueMsg, CW - 4)
      doc.text(lines, M + 2, y)
      y += lines.length * lineHeight() + 2
    }

    if (avgGesture != null) {
      checkPage(10)
      const gLabel = avgGesture > 0.4 ? 'very frequent hand gestures' : avgGesture > 0.15 ? 'moderate hand gestures' : 'minimal hand gestures'
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(8)
      doc.setTextColor(...TEXT2)
      const lines: string[] = doc.splitTextToSize(`Overall gesture activity: ${gLabel} throughout the interview.`, CW - 4)
      doc.text(lines, M + 2, y)
      y += lines.length * lineHeight() + 2
    }

    gap(2)
    rule()
  }

  // ── Full Transcript — FIX: skip intro question (is_intro) ───────────────

  sectionTitle('Full Transcript')

  const transcriptQuestions = report.per_question_scores ?? []

  transcriptQuestions.forEach((q, i) => {
    checkPage(40)

    const qHeaderH = 14
    doc.setFillColor(...SURFACE)
    doc.roundedRect(M, y, CW, qHeaderH, 3, 3, 'F')

    doc.setFont('helvetica', 'bold')
    doc.setFontSize(7)
    doc.setTextColor(...PRIMARY)
    const catLabel = q.category ? ` · ${prettyLabel(q.category)}` : ''
    doc.text(`Q${i + 1}${catLabel}`, M + 4, y + 5.5)

    if (q.anomaly_flagged) {
      doc.setFillColor(...WARNING)
      doc.roundedRect(PW - M - 22, y + 3, 18, 6, 2, 2, 'F')
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(6)
      doc.setTextColor(10, 10, 10)
      doc.text('ANOMALY', PW - M - 13, y + 7, { align: 'center' })
    }

    doc.setFont('helvetica', 'bold')
    doc.setFontSize(9)
    doc.setTextColor(...TEXT1)
    const qText = q.question_text ?? q.question ?? ''
    const qLines: string[] = doc.splitTextToSize(qText, CW - 8)
    const qH = doc.getFontSize() * doc.getLineHeightFactor() * (25.4 / 72)
    doc.text(qLines, M + 4, y + 10.5)
    y += qHeaderH + qLines.length * qH

    const answerText = q.answer_text ?? q.answer_transcript ?? ''
    if (answerText) {
      checkPage(16)
      gap(2)
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(7.5)
      const aLines: string[] = doc.splitTextToSize(answerText, CW - 8)
      const aH = doc.getFontSize() * doc.getLineHeightFactor() * (25.4 / 72)
      const aBoxH = aLines.length * aH + 6
      doc.setFillColor(18, 16, 28)
      doc.roundedRect(M, y, CW, aBoxH, 2, 2, 'F')
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(7.5)
      doc.setTextColor(...TEXT2)
      doc.text(aLines, M + 4, y + aH + 1)
      y += aBoxH + 3
    }

    checkPage(14)
    const metrics = [
      { label: 'Content',    value: q.content_score != null ? String(Math.round(q.content_score)) : '—', color: scoreColorRgb(q.content_score, 10) },
      { label: 'Comms',      value: q.communication_score != null ? String(Math.round(q.communication_score)) : '—', color: scoreColorRgb(q.communication_score, 10) },
      { label: 'Confidence', value: q.confidence_score != null ? String(Math.round(q.confidence_score)) : '—', color: scoreColorRgb(q.confidence_score, 10) },
      { label: 'WPM',        value: String(Math.round(q.audio_signals?.words_per_minute ?? q.wpm ?? 0) || '—'), color: TEXT2 },
      { label: 'Eye Contact', value: `${Math.round(q.video_signals?.eye_contact_percentage ?? q.eye_contact_pct ?? 0)}%`, color: TEXT2 },
    ]
    const mw = CW / metrics.length
    metrics.forEach((m, mi) => {
      const mx = M + mi * mw
      doc.setFillColor(...SURFACE2)
      doc.roundedRect(mx, y, mw - 1.5, 12, 2, 2, 'F')
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(9)
      doc.setTextColor(...m.color)
      doc.text(m.value, mx + mw / 2 - 0.75, y + 6.5, { align: 'center' })
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(6)
      doc.setTextColor(...TEXT3)
      doc.text(m.label, mx + mw / 2 - 0.75, y + 10.5, { align: 'center' })
    })
    y += 14

    if (q.justification) {
      checkPage(10)
      doc.setFont('helvetica', 'italic')
      doc.setFontSize(7.5)
      doc.setTextColor(...TEXT3)
      const jLines: string[] = doc.splitTextToSize(q.justification, CW - 4)
      doc.text(jLines, M + 2, y)
      y += jLines.length * lineHeight() + 2
    }

    // ── Body language summary — mirrors the web report's per-question tags ──
    const vs = q.video_signals
    if (vs) {
      const tags: string[] = []

      if (vs.dominant_position && vs.dominant_position !== 'unknown' && vs.dominant_position !== 'upright') {
        tags.push(`Position: ${prettyLabel(vs.dominant_position)}`)
      }
      if (vs.fatigue_trajectory && vs.fatigue_trajectory !== 'none') {
        tags.push(`Fatigue: ${prettyLabel(vs.fatigue_trajectory)}`)
      }
      if (vs.yawn_count != null && vs.yawn_count > 0) {
        tags.push(`Yawns: ${vs.yawn_count}`)
      }
      if (vs.head_movement_pattern && vs.head_movement_pattern !== 'unknown' && vs.head_movement_pattern !== 'natural') {
        tags.push(`Head: ${prettyLabel(vs.head_movement_pattern)}`)
      }
      if (vs.looking_down_pct != null && vs.looking_down_pct > 15) {
        tags.push(`Looking down: ${vs.looking_down_pct}%`)
      }
      if (vs.gesture_frequency != null && vs.gesture_frequency > 0.05) {
        const gLabel = vs.gesture_frequency > 0.4 ? 'very frequent' : vs.gesture_frequency > 0.15 ? 'moderate' : 'light'
        tags.push(`Gestures: ${gLabel}`)
      }
      if (vs.attention_arc && vs.attention_arc !== 'unknown') {
        tags.push(`Attention: ${prettyLabel(vs.attention_arc)}`)
      }
      if (vs.look_away_events?.length) {
        const totalSec = vs.look_away_events.reduce((s, e) => s + e.duration, 0)
        tags.push(`Look-aways: ${vs.look_away_events.length}x (~${Math.round(totalSec)}s)`)
      }
      if (vs.glasses_detected) {
        tags.push('Glasses detected (head-pose eye contact)')
      }
      if (vs.drowsiness_score != null && vs.drowsiness_score >= 4) {
        tags.push(`Drowsiness: ${vs.drowsiness_score}/10`)
      }

      if (tags.length) {
        checkPage(10)
        doc.setFont('helvetica', 'bold')
        doc.setFontSize(6)
        doc.setTextColor(...TEXT3)
        doc.text('BODY LANGUAGE', M + 2, y)
        y += 3.5
        doc.setFont('helvetica', 'normal')
        doc.setFontSize(7)
        doc.setTextColor(...TEXT2)
        const tagLine = tags.join('   ·   ')
        const tagLines: string[] = doc.splitTextToSize(tagLine, CW - 4)
        doc.text(tagLines, M + 2, y)
        y += tagLines.length * 4 + 2
      }
    }

    gap(6)

    if (i < transcriptQuestions.length - 1) {
      doc.setDrawColor(...DIVIDER)
      doc.setLineWidth(0.2)
      doc.line(M + 8, y - 2, PW - M - 8, y - 2)
    }
  })

  // ── Footer on every page ────────────────────────────────────────────────

  const totalPages = (doc as any).internal.getNumberOfPages()
  for (let p = 1; p <= totalPages; p++) {
    doc.setPage(p)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(6.5)
    doc.setTextColor(...TEXT3)
    doc.text('Generated by Tejaskrit AI · Interview Practice', M, PH - 7)
    doc.text(`Page ${p} / ${totalPages}`, PW - M, PH - 7, { align: 'right' })
    doc.setFillColor(...PRIMARY)
    doc.rect(0, PH - 2, PW, 2, 'F')
  }

  const filename = `Tejaskrit_${(report.candidate_name ?? candidateName).replace(/\s+/g, '_')}_Report.pdf`
  doc.save(filename)
}

function scoreColorRgb(v: number | undefined, max: number): [number, number, number] {
  if (v == null) return [110, 105, 140]
  const pct = v / max
  if (pct >= 0.75) return [60, 200, 120]
  if (pct >= 0.5)  return [230, 160, 40]
  return [210, 70, 70]
}