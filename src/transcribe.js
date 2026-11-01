// Model loading and chunked transcription (RUL-chunking, RUL-model-cache, RUL-progress).
import { TARGET_RATE } from './audio.js'
import { trimOverlap } from './markdown.js'
import { CODE, ScribeError, fail, looksLikeOom } from './errors.js'

export const MODEL_ID = 'Xenova/whisper-base'
export const CHUNK_SECONDS = 30
export const OVERLAP_SECONDS = 3

// Known artifact sizes: the download bar is measured against a fixed total and
// cannot move backwards when the decoder starts after the encoder.
export const EXPECTED_BYTES = {
  'encoder_model_quantized.onnx': 23200850,
  'decoder_model_merged_quantized.onnx': 53707539,
  'tokenizer.json': 2480466,
}
export const FRIENDLY = {
  'encoder_model_quantized.onnx': 'Encoder',
  'decoder_model_merged_quantized.onnx': 'Decoder',
  'tokenizer.json': 'Tokenizer',
}
const EXPECTED_TOTAL = Object.values(EXPECTED_BYTES).reduce((a, b) => a + b, 0)

let pending = null
let onDownload = null
let loaded = null
// Bytes per artifact, so the aggregate is a sum of real bytes, never a guess.
const perFile = new Map()
let downloadMax = 0 // the bar never moves backwards

// Loads the pipeline once per page. Later runs reuse it (UC-restart keeps the model).
export function loadTranscriber({ onProgress } = {}) {
  if (loaded) return Promise.resolve(loaded)
  onDownload = onProgress ?? null
  if (!pending) {
    pending = (async () => {
      if (typeof WebAssembly === 'undefined') throw fail(CODE.WASM_BLOCKED)
      const { pipeline, env } = await import('@huggingface/transformers')
      env.allowLocalModels = true
      env.allowRemoteModels = false
      env.localModelPath = '/models/'
      env.backends.onnx.wasm.numThreads = 1
      env.backends.onnx.wasm.wasmPaths = '/ort/'
      const tr = await pipeline('automatic-speech-recognition', MODEL_ID, {
        dtype: 'q8',
        device: 'wasm',
        progress_callback: handleProgress,
      })
      loaded = tr
      return tr
    })().catch((err) => {
      pending = null
      if (err instanceof ScribeError) throw err
      if (typeof WebAssembly === 'undefined' || /WebAssembly/i.test(String(err?.message))) {
        throw fail(CODE.WASM_BLOCKED, { cause: err })
      }
      throw fail(CODE.MODEL_DOWNLOAD, { cause: err, detail: String(err?.message || err) })
    })
  }
  return pending
}

function handleProgress(p) {
  if (!p || !onDownload) return
  if (p.status !== 'progress' || typeof p.loaded !== 'number') return
  const base = String(p.file || '').split('/').pop()
  if (!(base in EXPECTED_BYTES)) return
  const total = EXPECTED_BYTES[base]
  const got = Math.min(p.loaded, total)
  perFile.set(base, got)
  let sum = 0
  for (const v of perFile.values()) sum += v
  downloadMax = Math.max(downloadMax, Math.min(100, (sum / EXPECTED_TOTAL) * 100))
  onDownload({ row: { file: base, loaded: got, total }, pct: downloadMax, totalBytes: EXPECTED_TOTAL })
}

// Splits the audio into 30 s chunks with a 3 s lead-in overlap, transcribes each,
// trims the duplicated seam words, and yields to the event loop between chunks
// so progress paints (FLM-main-thread-block).
export async function transcribeChunked(transcriber, pcm, { language, onChunk }) {
  const span = CHUNK_SECONDS * TARGET_RATE
  const overlap = OVERLAP_SECONDS * TARGET_RATE
  const total = Math.max(1, Math.ceil(pcm.length / span))
  const chunks = []
  let partial = ''
  let prevText = ''

  for (let i = 0; i < total; i++) {
    const start = Math.max(0, i * span - (i ? overlap : 0))
    const end = Math.min(pcm.length, (i + 1) * span)
    const offset = start / TARGET_RATE
    const keepFrom = i ? (i * span) / TARGET_RATE - 0.4 : 0

    let res
    try {
      res = await transcriber(pcm.subarray(start, end), {
        return_timestamps: true,
        language: language || undefined,
        task: 'transcribe',
      })
    } catch (err) {
      if (looksLikeOom(err)) throw fail(CODE.OOM, { detail: String(err?.message || err) })
      throw err
    }

    const pieces = Array.isArray(res?.chunks)
      ? res.chunks
      : [{ text: res?.text || '', timestamp: [0, (end - start) / TARGET_RATE] }]

    const kept = []
    for (const p of pieces) {
      const t1 = (p.timestamp?.[1] ?? (end - start) / TARGET_RATE) + offset
      const text = (p.text || '').trim()
      if (!text) continue
      if (i && t1 <= keepFrom) continue // wholly inside the lead-in overlap
      kept.push(text)
    }
    const raw = kept.join(' ')
    const text = i ? trimOverlap(prevText, raw) : raw.trim()
    chunks.push({ index: i, start: i * CHUNK_SECONDS, text })
    if (text) {
      partial += (partial ? ' ' : '') + text
    }
    prevText = raw || prevText

    onChunk?.({ done: i + 1, total, text: partial, endSec: end / TARGET_RATE })
    await new Promise((resolve) => setTimeout(resolve, 30))
  }
  return chunks
}
