// Pure text logic: no DOM, no model. Covered by tests/markdown.test.js.

export const MODEL_LABEL = 'whisper-base (q8)'

// SET-language. `auto` leaves detection to the model.
export const LANGUAGES = [
  { code: 'auto', name: 'Auto-detect' },
  { code: 'en', name: 'English' },
  { code: 'fr', name: 'French' },
  { code: 'pt', name: 'Portuguese' },
  { code: 'sw', name: 'Swahili' },
  { code: 'es', name: 'Spanish' },
  { code: 'de', name: 'German' },
]

// Chichewa (ny) and Bemba (bem) are not offered: Whisper base has no language
// token for either, so a run would silently fall back to detection.
// Decision: spec/13-traceability/open-questions.csv (OQ-whisper-languages).

export function languageName(code) {
  return LANGUAGES.find((l) => l.code === code)?.name ?? code
}

// RUL-markdown-shape: H1 title, blockquote meta, H2 Transcript, then either
// timestamped paragraphs (one per 30 s chunk) or one flowing paragraph.
export function buildMarkdown({ sourceName, chunks, duration, language, withTimestamps }) {
  const lines = [
    `# ${titleOf(sourceName)}`,
    '',
    `> Transcribed on-device · ${fmtClock(duration)} · ${MODEL_LABEL} · language: ${
      language === 'auto' ? 'auto-detected' : `${languageName(language)} (${language})`
    }`,
    '',
    '## Transcript',
    '',
  ]
  const usable = chunks.filter((c) => c.text && c.text.trim())
  if (usable.length === 0) {
    lines.push('_No speech was recognised in this file._', '')
  } else if (withTimestamps) {
    for (const c of usable) lines.push(`**[${fmtClock(c.start)}]** ${c.text.trim()}`, '')
  } else {
    lines.push(usable.map((c) => c.text.trim()).join(' '), '')
  }
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n'
}

// "/path/My_talk-final.mp4" -> "My talk final"
export function titleOf(fileName) {
  const t = baseNameOf(fileName).replace(/[-_]+/g, ' ').trim()
  return t || 'Transcript'
}

// "My talk.mp4" -> "My talk" (used for the download file name)
export function baseNameOf(fileName) {
  const name = String(fileName || '')
    .split(/[\\/]/)
    .pop()
  return name.replace(/\.[^.]+$/, '').trim() || 'transcript'
}

export function fmtClock(seconds) {
  const s = Math.max(0, Math.round(Number(seconds) || 0))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
    : `${m}:${String(sec).padStart(2, '0')}`
}

export function prettyBytes(n) {
  if (n >= 1024 ** 3) return `${(n / 1024 ** 3).toFixed(1)} GB`
  return `${(n / 1024 ** 2).toFixed(n > 10 * 1024 ** 2 ? 0 : 1)} MB`
}

function normaliseWords(s) {
  return s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean)
}

// RUL-chunking: the next chunk starts 3 s early, so its opening words repeat
// the previous chunk's closing words. Drop the longest repeated run (>= 4 words)
// from the head of `nextText`.
export function trimOverlap(prevText, nextText) {
  const next = String(nextText || '').trim()
  if (!prevText || !next) return next
  const a = normaliseWords(prevText).slice(-14)
  const b = normaliseWords(next).slice(0, 14)
  const limit = Math.min(a.length, b.length)
  for (let n = limit; n >= 4; n--) {
    if (a.slice(-n).join(' ') === b.slice(0, n).join(' ')) {
      return next.split(/\s+/).slice(n).join(' ')
    }
  }
  return next
}
