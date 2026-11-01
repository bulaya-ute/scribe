// Failure modes (spec/11-non-functional/failure-modes.csv) mapped to messages that
// name what failed and what to try next (RUL-honest-errors, SST-error).
// Every ScribeError carries a support code. When the real cause is known, its
// text is included, so the message is derived from the failure, not generic.

export const CODE = {
  MODEL_DOWNLOAD: 'FLM-model-download',
  DECODE: 'FLM-decode',
  OOM: 'FLM-oom',
  FALLBACK_HANG: 'FLM-fallback-hang',
  WASM_BLOCKED: 'FLM-wasm-blocked',
  CLIPBOARD: 'UC-copy-markdown',
  UNKNOWN: 'FLM-unknown',
}

export const ACCEPTED_FORMATS = 'MP4 (H.264/AAC), MOV, WebM, MKV, M4A, MP3 and WAV'

export class ScribeError extends Error {
  constructor(code, message, { cause, stage, detail } = {}) {
    super(message)
    this.name = 'ScribeError'
    this.code = code
    this.stage = stage
    this.detail = detail || ''
    if (cause) this.cause = cause
  }
}

const MEMORY_RE = /out of memory|memory|allocation|out of bounds|\bOOM\b|Aborted\(\)/i

export function looksLikeOom(err) {
  return MEMORY_RE.test(String(err?.message || err || ''))
}

// The real error text, whitespace-collapsed and capped for display.
export function causeText(err) {
  const raw = String(err?.message || err || '').replace(/\s+/g, ' ').trim()
  if (!raw) return ''
  return raw.length > 160 ? `${raw.slice(0, 157)}…` : raw
}

function withDetail(text, detail) {
  return detail ? `${text} Cause: ${detail}` : text
}

export function fail(code, ctx = {}) {
  const detail = ctx.detail || causeText(ctx.cause)
  const meta = { cause: ctx.cause, stage: ctx.stage, detail }
  switch (code) {
    case CODE.MODEL_DOWNLOAD:
      return new ScribeError(
        code,
        withDetail(
          'The speech model could not be loaded from this site. Check the connection, then press Try again. If it keeps failing, reload the page once.',
          detail,
        ),
        meta,
      )
    case CODE.WASM_BLOCKED:
      return new ScribeError(
        code,
        withDetail(
          'WebAssembly is unavailable in this browser, or an extension is blocking it. Enable WebAssembly (or allow this site in the extension), then reload.',
          detail,
        ),
        meta,
      )
    case CODE.DECODE:
      return new ScribeError(
        code,
        withDetail(
          `This browser could not read the audio in ${ctx.name || 'this file'}, and the fallback decoder could not extract it either. Accepted formats: ${ACCEPTED_FORMATS}. Try one of those, or extract the audio first.`,
          detail,
        ),
        meta,
      )
    case CODE.FALLBACK_HANG:
      return new ScribeError(
        code,
        `The fallback decoder (ffmpeg.wasm) did not finish in time (${ctx.seconds ?? '?'} s) and stopped responding. Try MP4, MOV, M4A or WAV, or extract the audio track with another tool.`,
        meta,
      )
    case CODE.OOM:
      return new ScribeError(
        code,
        `This tab ran out of memory while processing ${ctx.name || 'the file'}${ctx.size ? ` (${ctx.size})` : ''}. Try a shorter clip or an audio-only file. The most a tab can hold depends on the device.`,
        meta,
      )
    case CODE.CLIPBOARD:
      return new ScribeError(
        code,
        'The browser blocked clipboard access. Use Download .md instead; the file is saved as written.',
        meta,
      )
    case CODE.UNKNOWN:
    default:
      return new ScribeError(
        code,
        withDetail(
          'The run stopped unexpectedly. Press Try again with the same file. Nothing was uploaded, and the file stays in this tab.',
          detail,
        ),
        meta,
      )
  }
}

// Turn anything thrown during a run into a ScribeError for the given stage.
export function classify(err, stage, ctx = {}) {
  if (err instanceof ScribeError) return err
  const detail = causeText(err)
  if (looksLikeOom(err)) return fail(CODE.OOM, ctx)
  if (stage === 'model') return fail(CODE.MODEL_DOWNLOAD, { cause: err, detail })
  if (stage === 'decode') return fail(CODE.DECODE, { ...ctx, cause: err, detail })
  return fail(CODE.UNKNOWN, { cause: err, detail })
}
