// Inference worker (FLM-main-thread-block). Owns the model and runs every chunk,
// so the page never blocks while Whisper runs. Messages in:
//   { type: 'load' }                          -> loads the pipeline, reports download progress
//   { type: 'transcribe', pcm, language }     -> runs chunked transcription, reports chunks
// Messages out: progress | ready | chunk | done | error
import { pipeline, env } from '@huggingface/transformers'

const MODEL_ID = 'Xenova/whisper-base'
const TARGET_RATE = 16000
const CHUNK_SECONDS = 30
const OVERLAP_SECONDS = 3

// Known artifact sizes: the download bar is measured against a fixed total.
const EXPECTED_BYTES = {
  'encoder_model_quantized.onnx': 23200850,
  'decoder_model_merged_quantized.onnx': 53707539,
  'tokenizer.json': 2480466,
}
const EXPECTED_TOTAL = Object.values(EXPECTED_BYTES).reduce((a, b) => a + b, 0)

env.allowLocalModels = true
env.allowRemoteModels = false
env.localModelPath = '/models/'
env.backends.onnx.wasm.numThreads = 1
env.backends.onnx.wasm.wasmPaths = '/ort/'

let transcriber = null
let loading = null
const perFile = new Map()
let downloadMax = 0

function handleProgress(p) {
  if (!p || p.status !== 'progress' || typeof p.loaded !== 'number') return
  const base = String(p.file || '').split('/').pop()
  if (!(base in EXPECTED_BYTES)) return
  const got = Math.min(p.loaded, EXPECTED_BYTES[base])
  perFile.set(base, got)
  let sum = 0
  for (const v of perFile.values()) sum += v
  downloadMax = Math.max(downloadMax, Math.min(100, (sum / EXPECTED_TOTAL) * 100))
  self.postMessage({
    type: 'progress',
    row: { file: base, loaded: got, total: EXPECTED_BYTES[base] },
    pct: downloadMax,
    totalBytes: EXPECTED_TOTAL,
  })
}

function load() {
  if (transcriber) return Promise.resolve(transcriber)
  if (!loading) {
    loading = pipeline('automatic-speech-recognition', MODEL_ID, {
      dtype: 'q8',
      device: 'wasm',
      progress_callback: handleProgress,
    }).then((tr) => {
      transcriber = tr
      return tr
    })
  }
  return loading
}

// Keeps the words the previous chunk already said out of the next one.
function normalise(s) {
  return s.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter(Boolean)
}
function trimOverlap(prevText, nextText) {
  const a = normalise(prevText).slice(-14)
  const b = normalise(nextText).slice(0, 14)
  const limit = Math.min(a.length, b.length)
  for (let n = limit; n >= 4; n--) {
    if (a.slice(-n).join(' ') === b.slice(0, n).join(' ')) {
      return nextText.trim().split(/\s+/).slice(n).join(' ')
    }
  }
  return nextText.trim()
}

async function transcribe({ pcm, language }) {
  const tr = await load()
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

    const res = await tr(pcm.subarray(start, end), {
      return_timestamps: true,
      language: language || undefined,
      task: 'transcribe',
    })
    const pieces = Array.isArray(res?.chunks)
      ? res.chunks
      : [{ text: res?.text || '', timestamp: [0, (end - start) / TARGET_RATE] }]

    const kept = []
    for (const p of pieces) {
      const t1 = (p.timestamp?.[1] ?? (end - start) / TARGET_RATE) + offset
      const text = (p.text || '').trim()
      if (!text) continue
      if (i && t1 <= keepFrom) continue
      kept.push(text)
    }
    const raw = kept.join(' ')
    const text = i ? trimOverlap(prevText, raw) : raw.trim()
    chunks.push({ index: i, start: i * CHUNK_SECONDS, text })
    if (text) partial += (partial ? ' ' : '') + text
    prevText = raw || prevText

    self.postMessage({ type: 'chunk', done: i + 1, total, text: partial, endSec: end / TARGET_RATE })
  }
  return chunks
}

self.onmessage = async (e) => {
  const msg = e.data
  try {
    if (msg.type === 'load') {
      await load()
      self.postMessage({ type: 'ready' })
    } else if (msg.type === 'transcribe') {
      const chunks = await transcribe(msg)
      self.postMessage({ type: 'done', chunks })
    }
  } catch (err) {
    self.postMessage({ type: 'error', message: String(err?.message || err), name: err?.name || 'Error' })
  }
}
