// Failure modes (spec/11-non-functional/failure-modes.csv) mapped to messages that
// name what failed and what to try next (RUL-honest-errors, SST-error).

export const CODE = {
  MODEL_DOWNLOAD: 'FLM-model-download',
  DECODE: 'FLM-decode',
  OOM: 'FLM-oom',
  FALLBACK_HANG: 'FLM-fallback-hang',
  WASM_BLOCKED: 'FLM-wasm-blocked',
  LANGUAGE: 'FLM-language',
  CLIPBOARD: 'UC-copy-markdown',
  UNKNOWN: 'FLM-unknown',
}

export const ACCEPTED_FORMATS = 'MP4 (H.264/AAC), MOV, WebM, MKV, M4A, MP3 and WAV'

export class ScribeError extends Error {
  constructor(code, message, { cause, stage } = {}) {
    super(message)
    this.name = 'ScribeError'
    this.code = code
    this.stage = stage
    if (cause) this.cause = cause
  }
}

const MEMORY_RE = /out of memory|memory|allocation|out of bounds|\bOOM\b|Aborted\(\)/i

export function looksLikeOom(err) {
  return MEMORY_RE.test(String(err?.message || err || ''))
}

export function fail(code, ctx = {}) {
  switch (code) {
    case CODE.MODEL_DOWNLOAD:
      return new ScribeError(
        code,
        'The speech model could not be loaded from this site. Check the connection and press Try again. If it keeps failing, reload the page once.',
        ctx,
      )
    case CODE.WASM_BLOCKED:
      return new ScribeError(
        code,
        'WebAssembly is unavailable in this browser, or an extension is blocking it. Enable WebAssembly (or allow this site in the extension), then reload.',
        ctx,
      )
    case CODE.DECODE:
      return new ScribeError(
        code,
        `This browser could not read the audio in ${ctx.name || 'this file'}, and the fallback decoder could not extract it either. Accepted formats: ${ACCEPTED_FORMATS}. Try one of those, or extract the audio first.`,
        ctx,
      )
    case CODE.FALLBACK_HANG:
      return new ScribeError(
        code,
        `The fallback decoder (ffmpeg.wasm) did not finish in time (${ctx.seconds ?? '?'} s) and stopped responding. Try MP4, MOV, M4A or WAV, or extract the audio track with another tool.`,
        ctx,
      )
    case CODE.OOM:
      return new ScribeError(
        code,
        `This tab ran out of memory while processing ${ctx.name || 'the file'}${ctx.size ? ` (${ctx.size})` : ''}. Try a shorter clip or an audio-only file. The most a tab can hold depends on the device.`,
        ctx,
      )
    case CODE.LANGUAGE:
      return new ScribeError(
        code,
        `The speech model has no ${ctx.name} language, so this run is not offered. Choose Auto-detect or another language.`,
        ctx,
      )
    case CODE.CLIPBOARD:
      return new ScribeError(
        code,
        'The browser blocked clipboard access. Use Download .md instead; the file is saved as written.',
        ctx,
      )
    default:
      return new ScribeError(
        code,
        `Unexpected error: ${ctx.detail || 'unknown'}. Press Try again. Nothing was uploaded, and the file stays in this tab.`,
        ctx,
      )
  }
}

// Turn anything thrown during a run into a ScribeError for the given stage.
export function classify(err, stage, ctx = {}) {
  if (err instanceof ScribeError) return err
  const detail = String(err?.message || err || 'unknown')
  if (looksLikeOom(err)) return fail(CODE.OOM, ctx)
  if (stage === 'model') return fail(CODE.MODEL_DOWNLOAD, { cause: err, detail })
  if (stage === 'decode') return fail(CODE.DECODE, { ...ctx, cause: err, detail })
  return fail(CODE.UNKNOWN, { cause: err, detail })
}
