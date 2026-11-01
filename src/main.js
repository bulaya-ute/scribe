import './styles.css'
import { pipeline, env } from '@huggingface/transformers'

env.allowLocalModels = true
env.allowRemoteModels = false
env.localModelPath = '/models/'
env.backends.onnx.wasm.numThreads = 1
// Serve the ONNX runtime from this origin — no CDN requests, so nothing
// about the file or the session leaves the browser except our own assets.
env.backends.onnx.wasm.wasmPaths = '/ort/'

const MODEL_ID = 'Xenova/whisper-base'
const TARGET_RATE = 16000
const MAX_BYTES = 500 * 1024 * 1024

const $ = (id) => document.getElementById(id)
const dropzone = $('dropzone')
const fileInput = $('file')
const pickBtn = $('pick')
const statusBox = $('status')
const statusText = $('status-text')
const statusPct = $('status-pct')
const bar = $('bar')
const barFill = $('bar-fill')
const stepsEl = $('steps')
const statusNote = $('status-note')
const errorBox = $('error')
const resultBox = $('result')
const preview = $('preview')
const metaEl = $('meta')
const languageSel = $('language')
const timestampsChk = $('timestamps')
const downloadsEl = $('downloads')

// Human names for the model artifacts transformers.js streams in parallel.
const FRIENDLY = {
  'encoder_model_quantized.onnx': 'Encoder',
  'decoder_model_merged_quantized.onnx': 'Decoder',
  'tokenizer.json': 'Tokenizer',
  'tokenizer_config.json': 'Tokenizer config',
  'config.json': 'Model config',
  'preprocessor_config.json': 'Preprocessor',
  'generation_config.json': 'Generation config',
}

const dlRows = new Map() // file -> { li, size, fill, loaded, total, lastPaint }

const mb = (n) => `${(n / 1024 ** 2).toFixed(1)} MB`

function resetDownloads() {
  downloadsEl.innerHTML = ''
  dlRows.clear()
}

// One row per artifact, each with its own bar. Updates are throttled per row so
// a fast stream doesn't thrash layout; CSS keeps the motion smooth (180ms linear).
const SHOWN_ARTIFACTS = new Set([
  'encoder_model_quantized.onnx',
  'decoder_model_merged_quantized.onnx',
  'tokenizer.json',
])

function updateDownloadRow(file, loaded, total) {
  const key = file || 'artifact'
  const base = key.split('/').pop()
  // Tiny config files would just add noise; they finish instantly.
  if (!SHOWN_ARTIFACTS.has(base)) return
  let row = dlRows.get(key)
  if (!row) {
    const li = document.createElement('li')
    const name = document.createElement('span')
    name.className = 'dl-name'
    name.textContent = FRIENDLY[base] || base
    const size = document.createElement('span')
    size.className = 'dl-size'
    size.textContent = '0 MB'
    const bar = document.createElement('div')
    bar.className = 'dl-bar'
    bar.setAttribute('role', 'progressbar')
    bar.setAttribute('aria-valuemin', '0')
    bar.setAttribute('aria-valuemax', '100')
    const fill = document.createElement('span')
    bar.append(fill)
    li.append(name, size, bar)
    downloadsEl.append(li)
    row = { li, size, fill, bar, loaded: 0, total: 0, lastPaint: 0 }
    dlRows.set(key, row)
  }

  row.loaded = loaded
  row.total = total

  const now = performance.now()
  const finished = total > 0 && loaded >= total
  if (now - row.lastPaint < 90 && !finished) return
  row.lastPaint = now

  const pct = total > 0 ? Math.min(100, (loaded / total) * 100) : 0
  row.fill.style.width = `${pct.toFixed(1)}%`
  row.bar.setAttribute('aria-valuenow', pct.toFixed(0))
  row.size.textContent = total > 0 ? `${mb(loaded)} / ${mb(total)}` : mb(loaded)
  if (finished) row.li.classList.add('done')
}

// Aggregate across all artifacts seen so far, so the main bar never jumps back.
function overallDownloadPct() {
  let loaded = 0
  let total = 0
  for (const row of dlRows.values()) {
    loaded += row.loaded
    total += row.total
  }
  return total > 0 ? (loaded / total) * 100 : 0
}

let transcriber = null
let markdown = ''
let baseName = 'transcript'
let running = false

/* ── state helpers ───────────────────────────────────────── */
function setStep(step, state) {
  const li = stepsEl.querySelector(`[data-step="${step}"]`)
  if (!li) return
  li.classList.remove('active', 'done')
  if (state) li.classList.add(state)
}

function setProgress(pct, text) {
  const clamped = Math.max(0, Math.min(100, Math.round(pct)))
  barFill.style.width = `${clamped}%`
  bar.setAttribute('aria-valuenow', String(clamped))
  statusPct.textContent = `${clamped}%`
  if (text) statusText.textContent = text
}

function showError(msg) {
  errorBox.textContent = msg
  errorBox.hidden = false
  statusBox.hidden = true
  running = false
}

function clearError() {
  errorBox.hidden = true
  errorBox.textContent = ''
}

function fmtClock(seconds) {
  const s = Math.max(0, Math.round(seconds))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
    : `${m}:${String(sec).padStart(2, '0')}`
}

const prettyBytes = (n) =>
  n > 1024 * 1024 * 1024
    ? `${(n / 1024 ** 3).toFixed(1)} GB`
    : `${(n / 1024 ** 2).toFixed(n > 10 * 1024 ** 2 ? 0 : 1)} MB`

/* ── audio extraction ────────────────────────────────────── */
async function extractWithWebAudio(file) {
  const ctx = new (window.AudioContext || window.webkitAudioContext)()
  try {
    const buf = await ctx.decodeAudioData(await file.arrayBuffer())
    const duration = buf.duration
    const off = new OfflineAudioContext(1, Math.max(1, Math.ceil(duration * TARGET_RATE)), TARGET_RATE)
    const src = off.createBufferSource()
    src.buffer = buf
    src.connect(off.destination)
    src.start(0)
    const rendered = await off.startRendering()
    return { pcm: rendered.getChannelData(0), duration }
  } finally {
    ctx.close?.()
  }
}

async function extractWithFFmpeg(file) {
  const { FFmpeg } = await import('@ffmpeg/ffmpeg')
  const { fetchFile } = await import('@ffmpeg/util')
  const ff = new FFmpeg()
  ff.on('log', ({ message }) => {
    if (message && /time=/.test(message)) statusNote.textContent = message.slice(0, 140)
  })
  await ff.load({
    coreURL: '/ffmpeg/ffmpeg-core.js',
    wasmURL: '/ffmpeg/ffmpeg-core.wasm',
    classWorkerURL: '/ffmpeg/worker.js',
  })
  const ext = (file.name.split('.').pop() || 'bin').toLowerCase().replace(/[^a-z0-9]/g, '')
  const inName = `input.${ext}`
  await ff.writeFile(inName, await fetchFile(file))
  await ff.exec(['-i', inName, '-vn', '-ac', '1', '-ar', String(TARGET_RATE), '-f', 'wav', 'out.wav'])
  const wav = await ff.readFile('out.wav')
  await ff.deleteFile(inName).catch(() => {})
  await ff.deleteFile('out.wav').catch(() => {})
  ff.terminate()

  const bytes = wav.buffer ?? wav
  const ctx = new (window.AudioContext || window.webkitAudioContext)()
  const decoded = await ctx.decodeAudioData(bytes.slice(0).buffer)
  ctx.close?.()
  return { pcm: decoded.getChannelData(0), duration: decoded.duration }
}

async function extractAudio(file) {
  setStep('decode', 'active')
  try {
    const out = await extractWithWebAudio(file)
    setStep('decode', 'done')
    return out
  } catch {
    statusText.textContent = 'Decoding with ffmpeg.wasm (unsupported codec for the browser)…'
    const out = await extractWithFFmpeg(file)
    setStep('decode', 'done')
    return out
  }
}

/* ── model ───────────────────────────────────────────────── */
async function getTranscriber() {
  if (transcriber) return transcriber
  setStep('model', 'active')
  resetDownloads()
  setProgress(0, 'Loading speech model…')
  transcriber = await pipeline('automatic-speech-recognition', MODEL_ID, {
    dtype: 'q8',
    device: 'wasm',
    progress_callback: (p) => {
      if (!p) return
      if (p.status === 'progress' && typeof p.loaded === 'number' && typeof p.total === 'number') {
        updateDownloadRow(p.file, p.loaded, p.total)
        // Stable label + aggregate bar: no line-by-line flicker while the
        // encoder and decoder stream in parallel.
        setProgress(overallDownloadPct(), 'Loading speech model…')
      } else if (p.status === 'done' && p.file) {
        const row = dlRows.get(p.file)
        if (row && row.total > 0) updateDownloadRow(p.file, row.total, row.total)
      } else if (p.status === 'ready') {
        setProgress(100, 'Model ready')
      }
    },
  })
  setStep('model', 'done')
  return transcriber
}


/* ── markdown assembly ───────────────────────────────────── */
function buildMarkdown({ name, chunks, duration, language, withTimestamps }) {
  const title = name.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ').trim() || 'Transcript'
  const lines = [
    `# ${title}`,
    '',
    `> Transcribed on-device · ${fmtClock(duration)} · ${MODEL_ID.split('/').pop()} (q8)` +
      (language ? ` · ${language}` : ''),
    '',
    '## Transcript',
    '',
  ]

  if (withTimestamps && chunks.length) {
    for (const c of chunks) {
      const [start] = c.timestamp ?? []
      const text = (c.text || '').trim()
      if (!text) continue
      lines.push(`**[${fmtClock(start ?? 0)}]** ${text}`, '')
    }
  } else {
    const paragraph = chunks.map((c) => (c.text || '').trim()).filter(Boolean).join(' ')
    lines.push(paragraph, '')
  }

  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n'
}

/* ── main run ────────────────────────────────────────────── */
async function run(file) {
  if (running) return
  running = true
  clearError()
  resultBox.hidden = true
  statusBox.hidden = false
  statusNote.textContent = 'First run downloads the speech model (~77 MB, cached afterwards).'
  setProgress(0, 'Reading file…')
  resetDownloads()
  stepsEl.querySelectorAll('li').forEach((li) => li.classList.remove('active', 'done'))

  if (file.size > MAX_BYTES) {
    showError(`That file is ${prettyBytes(file.size)}. The limit is 500 MB — trim it or extract the audio first.`)
    return
  }

  baseName = (file.name || 'transcript').replace(/\.[^.]+$/, '') || 'transcript'
  const started = performance.now()

  try {
    const { pcm, duration } = await extractAudio(file)

    const transcriber = await getTranscriber()

    setStep('transcribe', 'active')
    let lastPct = 0
    const chunks = []

    const output = await transcriber(pcm, {
      chunk_length_s: 30,
      stride_length_s: 5,
      return_timestamps: true,
      language: languageSel.value || undefined,
      task: 'transcribe',
      callback_function: (beams) => {
        // Progress is proportion of processed chunks against total duration.
        const end = beams?.[0]?.timestamp?.[1] ?? null
        if (end != null && duration > 0) {
          lastPct = Math.min(99, (end / duration) * 100)
          setProgress(lastPct, `Transcribing · ${fmtClock(end)} of ${fmtClock(duration)}`)
        }
      },
    })

    if (Array.isArray(output.chunks)) chunks.push(...output.chunks)
    else if (output.text) chunks.push({ text: output.text, timestamp: [0, duration] })

    setStep('transcribe', 'done')
    setProgress(100, 'Done')

    markdown = buildMarkdown({
      name: file.name,
      chunks,
      duration,
      language: output.language || languageSel.value || '',
      withTimestamps: timestampsChk.checked,
    })

    preview.textContent = markdown
    metaEl.innerHTML = ''
    const meta = [
      ['file', file.name],
      ['duration', fmtClock(duration)],
      ['size', prettyBytes(file.size)],
      ['model', 'whisper-base q8'],
      ['took', `${((performance.now() - started) / 1000).toFixed(0)}s`],
    ]
    for (const [k, v] of meta) {
      const div = document.createElement('div')
      const dt = document.createElement('dt')
      dt.textContent = k
      const dd = document.createElement('dd')
      dd.textContent = v
      div.append(dt, dd)
      metaEl.append(div)
    }

    resultBox.hidden = false
    statusBox.hidden = true
    resultBox.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  } catch (err) {
    console.error(err)
    const msg = String(err?.message || err)
    if (/memory|allocation|out of bounds|OOM/i.test(msg)) {
      showError('Ran out of memory while processing. Try a shorter clip, or extract the audio track first.')
    } else if (/decode|codec/i.test(msg)) {
      showError('Could not decode that file’s audio. Try MP4 (H.264/AAC), MOV, WebM or M4A.')
    } else {
      showError(`Something went wrong: ${msg}`)
    }
  } finally {
    running = false
  }
}

/* ── wiring ──────────────────────────────────────────────── */
function openPicker() {
  if (!running) fileInput.click()
}

pickBtn.addEventListener('click', (e) => {
  e.stopPropagation()
  openPicker()
})

dropzone.addEventListener('click', openPicker)
dropzone.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault()
    openPicker()
  }
})

fileInput.addEventListener('change', () => {
  const f = fileInput.files?.[0]
  if (f) run(f)
  fileInput.value = ''
})

;['dragenter', 'dragover'].forEach((evt) =>
  dropzone.addEventListener(evt, (e) => {
    e.preventDefault()
    dropzone.classList.add('dragover')
  }),
)

;['dragleave', 'drop'].forEach((evt) =>
  dropzone.addEventListener(evt, (e) => {
    e.preventDefault()
    dropzone.classList.remove('dragover')
  }),
)

dropzone.addEventListener('drop', (e) => {
  const f = e.dataTransfer?.files?.[0]
  if (f) run(f)
})

$('copy').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(markdown)
    const btn = $('copy')
    const old = btn.textContent
    btn.textContent = 'Copied'
    setTimeout(() => (btn.textContent = old), 1400)
  } catch {
    showError('Clipboard blocked by the browser — use Download instead.')
  }
})

$('download').addEventListener('click', () => {
  const blob = new Blob([markdown], { type: 'text/markdown;charset=utf-8' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = `${baseName}.md`
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 4000)
})

$('again').addEventListener('click', () => {
  resultBox.hidden = true
  statusBox.hidden = true
  clearError()
  setProgress(0, 'Working…')
  stepsEl.querySelectorAll('li').forEach((li) => li.classList.remove('active', 'done'))
  fileInput.value = ''
})
