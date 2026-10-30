import type { jsPDF as JsPDF } from 'jspdf'
import type { ReportResponse } from './interview-api'

type RGB = [number, number, number]

// Print-friendly version of the app's palette: dark ink on white with a deep teal accent.
const INK    : RGB = [14, 28, 25]
const INK2   : RGB = [62, 80, 75]
const INK3   : RGB = [112, 130, 124]
const RULE   : RGB = [212, 224, 220]
const TINT   : RGB = [238, 246, 243]
const ACCENT : RGB = [13, 148, 120]
const GREEN  : RGB = [47, 125, 79]
const AMBER  : RGB = [168, 101, 15]
const RED    : RGB = [196, 47, 47]

const PW = 210
const PH = 297
const M = 18
const CW = PW - M * 2
const BOTTOM = PH - 18 // keep clear of the footer

function prettyLabel(k: string) {
  return k.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}

// The built-in PDF fonts only cover Windows-1252. AI transcripts often contain
// non-breaking hyphens, narrow spaces, emoji etc., which would print as garbage.
const WIN1252_EXTRA = new Set('€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ')
const REPLACEMENTS: Record<string, string> = {
  '‐': '-', '‑': '-', '‒': '-', '―': '—', '−': '-',
  ' ': ' ', ' ': ' ', ' ': ' ', ' ': ' ', ' ': ' ',
  '′': "'", '″': '"', '←': '<-', '→': '->', '≤': '<=', '≥': '>=',
  '≈': '~', '×': 'x', '✓': 'v',
}
function clean(text: string | null | undefined): string {
  if (!text) return ''
  let out = ''
  for (const ch of text.normalize('NFC')) {
    const code = ch.codePointAt(0) ?? 0
    if (code === 0x0a || (code >= 0x20 && code <= 0x7e) || (code >= 0xa0 && code <= 0xff) || WIN1252_EXTRA.has(ch)) {
      out += REPLACEMENTS[ch] ?? ch
    } else if (REPLACEMENTS[ch]) {
      out += REPLACEMENTS[ch]
    } else if (code === 0x09) {
      out += ' '
    }
    // anything else (emoji, CJK, zero-width characters) is dropped
  }
  return out.replace(/[ ]{2,}/g, ' ').trim()
}

function scoreColor(value: number | null | undefined, max: number): RGB {
  if (value == null) return INK3
  const pct = value / max
  return pct >= 0.7 ? GREEN : pct >= 0.5 ? AMBER : RED
}

/** Builds the report PDF (no download), so it can be saved, previewed or tested. */
export async function buildReportPDF(report: ReportResponse, candidateName: string, jobTitle: string): Promise<JsPDF> {
  const { jsPDF } = await import('jspdf')
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
  let y = M

  const lineH = () => doc.getFontSize() * doc.getLineHeightFactor() * (25.4 / 72)
  const font = (style: 'normal' | 'bold' | 'italic', size: number, color: RGB, face: 'helvetica' | 'times' = 'helvetica') => {
    doc.setFont(face, style)
    doc.setFontSize(size)
    doc.setTextColor(...color)
  }
  const newPage = () => { doc.addPage(); y = M }
  const ensure = (needed: number) => { if (y + needed > BOTTOM) newPage() }

  /** Wrapped text that breaks across pages line by line. */
  function para(text: string, x: number, width: number, opts: { after?: number } = {}) {
    const lines: string[] = doc.splitTextToSize(clean(text), width)
    const lh = lineH()
    for (const line of lines) {
      ensure(lh)
      doc.text(line, x, y + lh * 0.75)
      y += lh
    }
    y += opts.after ?? 0
  }

  function sectionTitle(text: string) {
    ensure(34) // never leave a heading alone at the bottom of a page
    y += 6
    font('bold', 15, INK, 'times')
    doc.text(text, M, y + 5)
    y += 8
    doc.setDrawColor(...ACCENT)
    doc.setLineWidth(0.6)
    doc.line(M, y, M + 14, y)
    y += 6
  }

  function bulletList(items: string[], marker: RGB) {
    for (const item of items) {
      font('normal', 9.5, INK)
      const lines: string[] = doc.splitTextToSize(clean(item), CW - 7)
      const lh = lineH()
      ensure(Math.min(lines.length, 3) * lh + 2)
      doc.setFillColor(...marker)
      doc.rect(M + 0.5, y + lh * 0.38, 1.8, 1.8, 'F')
      for (const line of lines) {
        ensure(lh)
        doc.text(line, M + 6, y + lh * 0.75)
        y += lh
      }
      y += 2.2
    }
  }

  // ── Header ───────────────────────────────────────────────────────────────
  const name = clean(report.candidate_name || candidateName) || 'Candidate'
  const role = clean(report.job_title || jobTitle)
  const date = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })

  font('bold', 8, ACCENT)
  doc.text('TEJASKRIT', M, y + 3)
  font('normal', 8, INK3)
  doc.text('Interview practice report', M + doc.getTextWidth('TEJASKRIT') + 6, y + 3)
  doc.text(date, PW - M, y + 3, { align: 'right' })
  y += 6
  doc.setDrawColor(...INK)
  doc.setLineWidth(0.4)
  doc.line(M, y, PW - M, y)
  y += 12

  font('bold', 28, INK, 'times')
  para(name, M, CW)
  y += 1
  if (role) {
    font('normal', 12, INK2)
    para(role, M, CW)
  }
  const answered = (report.per_question_scores ?? []).length
  const meta = [
    report.interview_duration_minutes ? `${Math.round(report.interview_duration_minutes)} min` : '',
    answered ? `${answered} question${answered === 1 ? '' : 's'}` : '',
  ].filter(Boolean).join('   ·   ')
  if (meta) {
    font('normal', 9, INK3)
    para(meta, M, CW)
  }
  y += 8

  // ── Overall score + recommendation ────────────────────────────────────────
  const score = Math.round(report.overall_score ?? 0)
  const boxH = 34
  ensure(boxH + 4)
  doc.setFillColor(...TINT)
  doc.roundedRect(M, y, CW, boxH, 3, 3, 'F')

  font('bold', 40, scoreColor(score, 100), 'times')
  doc.text(String(score), M + 8, y + 22)
  const scoreW = doc.getTextWidth(String(score))
  font('normal', 10, INK3)
  doc.text('/ 100', M + 9 + scoreW, y + 22)
  font('bold', 7, INK3)
  doc.text('OVERALL SCORE', M + 8, y + 29)

  // Score bar across the middle of the box
  const barX = M + 62, barW = CW - 62 - 52, barY = y + 15
  doc.setFillColor(...RULE)
  doc.roundedRect(barX, barY, barW, 3, 1.5, 1.5, 'F')
  doc.setFillColor(...scoreColor(score, 100))
  doc.roundedRect(barX, barY, Math.max(3, barW * Math.min(score, 100) / 100), 3, 1.5, 1.5, 'F')
  font('normal', 7, INK3)
  doc.text('0', barX, barY + 8)
  doc.text('100', barX + barW, barY + 8, { align: 'right' })

  const reco = clean(report.recommendation || 'maybe').toUpperCase().replace(/[\s_]+/g, ' ')
  const recoColor = reco.includes('NO') ? RED : reco.includes('HIRE') ? GREEN : AMBER
  font('bold', 9, [255, 255, 255])
  const pillW = Math.max(30, doc.getTextWidth(reco) + 12)
  const pillX = PW - M - 8 - pillW
  doc.setFillColor(...recoColor)
  doc.roundedRect(pillX, y + 9, pillW, 9, 4.5, 4.5, 'F')
  doc.text(reco, pillX + pillW / 2, y + 15, { align: 'center' })
  const conf = report.recommendation_confidence as unknown
  const confText = typeof conf === 'number'
    ? `${Math.round(conf <= 1 ? conf * 100 : conf)}% confidence`
    : conf ? `${clean(String(conf))} confidence` : ''
  if (confText) {
    font('normal', 7.5, INK3)
    doc.text(confText, pillX + pillW / 2, y + 24, { align: 'center' })
  }
  y += boxH + 6

  if (report.summary) {
    font('normal', 10, INK)
    doc.setLineHeightFactor(1.35)
    para(report.summary, M, CW, { after: 2 })
    doc.setLineHeightFactor(1.15)
  }

  // ── Score breakdown table ────────────────────────────────────────────────
  const breakdown = Object.entries(report.breakdown ?? {})
  if (breakdown.length) {
    sectionTitle('Score breakdown')
    font('bold', 7, INK3)
    doc.text('AREA', M, y + 3)
    doc.text('WEIGHT', M + 70, y + 3)
    doc.text('SCORE', PW - M, y + 3, { align: 'right' })
    y += 5
    doc.setDrawColor(...RULE)
    doc.setLineWidth(0.3)
    doc.line(M, y, PW - M, y)
    for (const [key, raw] of breakdown) {
      ensure(10)
      const v = Math.max(0, Math.min(10, Number(raw) || 0))
      const rowY = y + 6.5
      font('normal', 10, INK)
      doc.text(prettyLabel(key), M, rowY)
      const weight = report.rubric?.[key]
      font('normal', 9, INK3)
      doc.text(weight != null ? `${weight}%` : '—', M + 70, rowY)
      const bx = M + 88, bw = CW - 88 - 22
      doc.setFillColor(...TINT)
      doc.roundedRect(bx, rowY - 2.4, bw, 2.6, 1.3, 1.3, 'F')
      doc.setFillColor(...scoreColor(v, 10))
      doc.roundedRect(bx, rowY - 2.4, Math.max(2.6, bw * v / 10), 2.6, 1.3, 1.3, 'F')
      font('bold', 10, scoreColor(v, 10))
      doc.text(`${Math.round(v * 10) / 10}`, PW - M - 7, rowY, { align: 'right' })
      font('normal', 8, INK3)
      doc.text('/10', PW - M, rowY, { align: 'right' })
      y += 10
      doc.setDrawColor(...RULE)
      doc.line(M, y, PW - M, y)
    }
    y += 2
  }

  // ── Strengths / improvements / red flags ─────────────────────────────────
  if (report.strengths?.length) {
    sectionTitle('Strengths')
    bulletList(report.strengths, GREEN)
  }
  if (report.weaknesses?.length) {
    sectionTitle('Areas to improve')
    bulletList(report.weaknesses, AMBER)
  }
  if (report.red_flags?.length) {
    sectionTitle('Red flags')
    bulletList(report.red_flags, RED)
  }

  // ── Body language overview ───────────────────────────────────────────────
  const questions = report.per_question_scores ?? []
  const withVideo = questions.filter(q => q.video_signals && q.video_signals.video_available !== false)
  const notes: string[] = []
  if (withVideo.length) {
    const avg = (pick: (q: typeof withVideo[number]) => number | undefined) => {
      const vals = withVideo.map(pick).filter((v): v is number => typeof v === 'number')
      return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null
    }
    const eye = avg(q => q.video_signals?.eye_contact_percentage)
    if (eye != null) notes.push(`Average eye contact: ${Math.round(eye)}% of answering time.`)
    const gesture = avg(q => q.video_signals?.gesture_frequency)
    if (gesture != null) notes.push(`Hand gestures: ${gesture > 0.4 ? 'very frequent' : gesture > 0.15 ? 'moderate' : 'minimal'} across the interview.`)
    if (withVideo.some(q => q.video_signals?.glasses_detected)) notes.push('Glasses detected - eye contact was estimated from head pose for some answers.')
    const yawns = withVideo.reduce((s, q) => s + (q.video_signals?.yawn_count ?? 0), 0)
    if (withVideo.some(q => ['moderate', 'severe'].includes(q.video_signals?.fatigue_trajectory ?? ''))) {
      notes.push(yawns ? `Signs of fatigue, including ${yawns} yawn(s). Practise when well rested.` : 'Signs of fatigue were visible in some answers.')
    }
  } else if (questions.length) {
    notes.push('Video was not available (camera off or face not visible), so presence was not scored.')
  }
  if (notes.length) {
    sectionTitle('Presence on camera')
    bulletList(notes, INK3)
  }

  // ── Question by question ─────────────────────────────────────────────────
  if (questions.length) {
    sectionTitle('Question by question')
  }
  let number = 0
  questions.forEach((q, i) => {
    const label = q.is_intro ? 'Introduction' : `Question ${++number}`
    const cat = q.category ? prettyLabel(q.category) : ''
    ensure(32) // keep the header, question and the start of the answer together

    font('bold', 8, ACCENT)
    doc.text(`${label.toUpperCase()}${cat ? `  ·  ${cat.toUpperCase()}` : ''}`, M, y + 3)
    if (q.anomaly_flagged) {
      font('bold', 7, AMBER)
      doc.text(q.anomaly_reason === 'no_speech_detected' ? 'NO SPEECH DETECTED' : 'FLAGGED', PW - M, y + 3, { align: 'right' })
    }
    y += 6

    font('bold', 11, INK)
    para(q.question_text ?? (q as { question?: string }).question ?? '', M, CW, { after: 2 })

    const answer = clean(q.answer_text ?? (q as { answer_transcript?: string }).answer_transcript ?? '')
    font('normal', 9, INK2)
    const aLines: string[] = answer ? doc.splitTextToSize(answer, CW - 10) : []
    const lh = lineH()
    if (!aLines.length) {
      font('italic', 9, INK3)
      para('No answer recorded.', M, CW, { after: 2 })
    }
    // The answer box continues onto the next page when it doesn't fit.
    let idx = 0
    while (idx < aLines.length) {
      ensure(lh + 6)
      const room = Math.floor((BOTTOM - y - 6) / lh)
      const chunk = aLines.slice(idx, idx + Math.max(1, room))
      const h = chunk.length * lh + 6
      doc.setFillColor(...TINT)
      doc.roundedRect(M, y, CW, h, 2, 2, 'F')
      doc.setFillColor(...ACCENT)
      doc.rect(M, y, 0.8, h, 'F')
      font('normal', 9, INK2)
      chunk.forEach((line, li) => doc.text(line, M + 5, y + 3 + lh * (li + 0.75)))
      y += h
      idx += chunk.length
      if (idx < aLines.length) newPage()
    }
    y += 3

    // Scores line
    const wpm = Math.round(q.audio_signals?.words_per_minute ?? (q as { wpm?: number }).wpm ?? 0)
    const videoOff = q.video_signals?.video_available === false
    const eye = q.video_signals?.eye_contact_percentage ?? (q as { eye_contact_pct?: number }).eye_contact_pct
    const chips: { label: string; value: string; color: RGB }[] = [
      { label: 'Content', value: q.content_score != null ? `${Math.round(q.content_score)}/10` : '—', color: scoreColor(q.content_score, 10) },
      { label: 'Communication', value: q.communication_score != null ? `${Math.round(q.communication_score)}/10` : '—', color: scoreColor(q.communication_score, 10) },
      { label: 'Confidence', value: q.confidence_score != null ? `${Math.round(q.confidence_score)}/10` : '—', color: scoreColor(q.confidence_score, 10) },
      { label: 'Pace', value: wpm ? `${wpm} wpm` : '—', color: INK2 },
      { label: 'Eye contact', value: videoOff || eye == null ? 'n/a' : `${Math.round(eye)}%`, color: INK2 },
    ]
    ensure(11)
    const cw = CW / chips.length
    chips.forEach((c, ci) => {
      const cx = M + ci * cw
      font('bold', 10, c.color)
      doc.text(c.value, cx, y + 4)
      font('normal', 7, INK3)
      doc.text(c.label.toUpperCase(), cx, y + 8)
    })
    y += 11

    if (q.justification) {
      font('italic', 8.5, INK2)
      para(q.justification, M, CW, { after: 1 })
    }

    const vs = q.video_signals
    if (vs && !videoOff) {
      const tags: string[] = []
      if (vs.dominant_position && !['unknown', 'upright'].includes(vs.dominant_position)) tags.push(`Posture: ${prettyLabel(vs.dominant_position)}`)
      if (vs.attention_arc && vs.attention_arc !== 'unknown') tags.push(`Attention: ${prettyLabel(vs.attention_arc)}`)
      if (vs.look_away_events?.length) tags.push(`Looked away ${vs.look_away_events.length}x (~${Math.round(vs.look_away_events.reduce((s, e) => s + e.duration, 0))}s)`)
      if (vs.looking_down_pct != null && vs.looking_down_pct > 15) tags.push(`Looking down ${Math.round(vs.looking_down_pct)}%`)
      if (vs.fatigue_trajectory && vs.fatigue_trajectory !== 'none') tags.push(`Fatigue: ${prettyLabel(vs.fatigue_trajectory)}`)
      if (vs.yawn_count) tags.push(`Yawns: ${vs.yawn_count}`)
      if (tags.length) {
        font('normal', 8, INK3)
        para(tags.join('   ·   '), M, CW)
      }
    }

    y += 4
    if (i < questions.length - 1) {
      ensure(6)
      doc.setDrawColor(...RULE)
      doc.setLineWidth(0.3)
      doc.line(M, y, PW - M, y)
      y += 6
    }
  })

  // ── Footer on every page ─────────────────────────────────────────────────
  const total = doc.getNumberOfPages()
  for (let p = 1; p <= total; p++) {
    doc.setPage(p)
    doc.setDrawColor(...RULE)
    doc.setLineWidth(0.3)
    doc.line(M, PH - 12, PW - M, PH - 12)
    font('normal', 7.5, INK3)
    doc.text(`${name}  ·  ${role || 'Interview practice'}`, M, PH - 7.5)
    doc.text(`tejaskrit  ·  page ${p} of ${total}`, PW - M, PH - 7.5, { align: 'right' })
  }

  return doc
}

export async function downloadReportPDF(report: ReportResponse, candidateName: string, jobTitle: string) {
  const doc = await buildReportPDF(report, candidateName, jobTitle)
  const safeName = (clean(report.candidate_name || candidateName) || 'Candidate').replace(/[^\w-]+/g, '_')
  doc.save(`Tejaskrit_${safeName}_Report.pdf`)
}
