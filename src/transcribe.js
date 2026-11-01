// Client for the inference worker (FLM-main-thread-block). The model and all
// inference live in transcribe.worker.js; this module only sends PCM and
// relays progress, so the page stays responsive during a run.
import { CODE, fail } from './errors.js'

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

let worker = null
let loadPromise = null
let onDownload = null
let onChunk = null
let pending = null // { resolve, reject } for the transcribe call in flight

function toScribeError(m) {
  const text = String(m.message || '')
  if (/WebAssembly/i.test(text)) return fail(CODE.WASM_BLOCKED, { detail: text })
  if (/memory|allocation|out of bounds/i.test(text)) return fail(CODE.OOM, { detail: text })
  return fail(CODE.MODEL_DOWNLOAD, { detail: text })
}

function getWorker() {
  if (worker) return worker
  if (typeof Worker === 'undefined' || typeof WebAssembly === 'undefined') {
    throw fail(CODE.WASM_BLOCKED)
  }
  worker = new Worker(new URL('./transcribe.worker.js', import.meta.url), { type: 'module' })
  worker.onmessage = (e) => {
    const m = e.data
    if (m.type === 'progress') onDownload?.({ row: m.row, pct: m.pct, totalBytes: m.totalBytes })
    else if (m.type === 'chunk') onChunk?.(m)
    else if (m.type === 'done') {
      const p = pending
      pending = null
      p?.resolve(m.chunks)
    } else if (m.type === 'error') {
      const p = pending
      pending = null
      p?.reject(toScribeError(m))
    }
  }
  worker.onerror = (ev) => {
    const p = pending
    pending = null
    p?.reject(fail(CODE.WASM_BLOCKED, { detail: ev.message }))
  }
  return worker
}

// Loads the model inside the worker once per page; later runs reuse it (UC-restart).
export function loadTranscriber({ onProgress } = {}) {
  onDownload = onProgress ?? null
  if (!loadPromise) {
    loadPromise = new Promise((resolve, reject) => {
      const w = getWorker()
      const forward = w.onmessage
      w.onmessage = (e) => {
        if (e.data.type === 'ready') {
          w.onmessage = forward
          resolve({ ready: true })
        } else if (e.data.type === 'error') {
          w.onmessage = forward
          loadPromise = null
          reject(toScribeError(e.data))
        } else {
          forward(e)
        }
      }
      w.postMessage({ type: 'load' })
    })
  }
  return loadPromise
}

// Runs chunked transcription in the worker. Resolves with the chunk list.
export function transcribeChunked(_handle, pcm, { language, onChunk: cb }) {
  onChunk = cb ?? null
  return new Promise((resolve, reject) => {
    pending = { resolve, reject }
    // Copy the samples and transfer the copy, so the caller's buffer is untouched.
    const copy = new Float32Array(pcm)
    getWorker().postMessage({ type: 'transcribe', pcm: copy, language }, [copy.buffer])
  })
}
