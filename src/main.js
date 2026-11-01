import './tokens.css'
import './styles.css'
import { extractAudio } from './audio.js'
import { loadTranscriber, transcribeChunked, EXPECTED_BYTES, FRIENDLY } from './transcribe.js'
import { buildMarkdown, baseNameOf, fmtClock, prettyBytes, languageName } from './markdown.js'
import { CODE, ScribeError, fail, classify } from './errors.js'
import { logFailure } from './log.js'

const $ = (id) => document.getElementById(id)
const APP_VERSION = __APP_VERSION__
const THEME_KEY = 'scribe-theme'
const STAGES = ['decode', 'model', 'transcribe']

const els = {
  version: $('version'),
  theme: $('theme'),
  themeLabel: $('theme-label'),
  dropzone: $('dropzone'),
  pick: $('pick'),
  file: $('file'),
  fileName: $('file-name'),
  language: $('language'),
  timestamps: $('timestamps'),
  advisory: $('advisory'),
  status: $('status'),
  statusText: $('status-text'),
  statusPct: $('status-pct'),
  bar: $('bar'),
  barFill: $('bar-fill'),
  steps: $('steps'),
  dlList: $('dl-list'),
  partial: $('partial'),
  statusNote: $('status-note'),
  error: $('error'),
  errorText: $('error-text'),
  errorCode: $('error-code'),
  retry: $('retry'),
  result: $('result'),
  copy: $('copy'),
  download: $('download'),
  again: $('again'),
  meta: $('meta'),
  preview: $('preview'),
}

els.version.textContent = `v${APP_VERSION}`

/* ── theme (RUL-theme-system) ─────────────────────────── */
function savedTheme() {
  try {
    const v = localStorage.getItem(THEME_KEY)
    return v === 'light' || v === 'dark' ? v : null
  } catch {
    return null
  }
}

function effectiveTheme() {
  const saved = savedTheme()
  if (saved) return saved
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme
  const next = theme === 'dark' ? 'light' : 'dark'
  els.theme.setAttribute('aria-label', `Switch to ${next} theme`)
  els.themeLabel.textContent = `Theme: ${theme}. Switch to ${next}.`
}

function initTheme() {
  const saved = savedTheme()
  if (saved) document.documentElement.dataset.theme = saved
  applyTheme(effectiveTheme())
  els.theme.addEventListener('click', () => {
    const next = effectiveTheme() === 'dark' ? 'light' : 'dark'
    try {
      localStorage.setItem(THEME_KEY, next)
    } catch {
      /* storage blocked: the choice still applies for this visit */
    }
    applyTheme(next)
  })
  window.matchMedia?.('(prefers-color-scheme: dark)').addEventListener?.('change', () => {
    if (!savedTheme()) applyTheme(effectiveTheme())
  })
}

/* ── run state ─────────────────────────────────────────── */
let currentFile = null
let markdown = ''
let baseName = 'transcript'
let running = false
let stage = null
let stageTimer = null
let stageStart = 0

const dlRows = new Map()

function setStage(name) {
  stage = name
  for (const s of STAGES) {
    const li = els.steps.querySelector(`[data-step="${s}"]`)
    li.classList.toggle('active', s === name)
    li.classList.toggle('done', STAGES.indexOf(s) < STAGES.indexOf(name))
  }
}

function setProgress(pct, text) {
  if (pct == null) {
    els.bar.classList.add('indeterminate')
    els.barFill.style.width = ''
    els.bar.removeAttribute('aria-valuenow')
    els.statusPct.textContent = ''
  } else {
    const clamped = Math.max(0, Math.min(100, Math.round(pct)))
    els.bar.classList.remove('indeterminate')
    els.barFill.style.width = `${clamped}%`
    els.bar.setAttribute('aria-valuenow', String(clamped))
    els.statusPct.textContent = `${clamped}%`
  }
  if (text) els.statusText.textContent = text
}

// Indeterminate stages (native decode, ffmpeg fallback) show elapsed time, never an ETA.
function startElapsed(label) {
  stopElapsed()
  stageStart = performance.now()
  const tick = () => {
    const s = (performance.now() - stageStart) / 1000
    setProgress(null, `${label} · ${fmtClock(s)} elapsed`)
  }
  tick()
  stageTimer = setInterval(tick, 1000)
}

function stopElapsed() {
  if (stageTimer) clearInterval(stageTimer)
  stageTimer = null
}

function resetDownloads() {
  els.dlList.innerHTML = ''
  dlRows.clear()
}

function updateDownloadRow(base, loaded, total) {
  if (!EXPECTED_BYTES[base]) return
  let row = dlRows.get(base)
  if (!row) {
    const li = document.createElement('li')
    const name = document.createElement('span')
    name.className = 'dl-name'
    name.textContent = FRIENDLY[base] || base
    const size = document.createElement('span')
    size.className = 'dl-size'
    const bar = document.createElement('div')
    bar.className = 'bar'
    const fill = document.createElement('span')
    bar.append(fill)
    li.append(name, size, bar)
    els.dlList.append(li)
    row = { li, size, fill }
    dlRows.set(base, row)
  }
  const pct = total ? Math.min(100, (loaded / total) * 100) : 0
  row.fill.style.width = `${pct.toFixed(1)}%`
  row.size.textContent = `${prettyBytes(loaded)} / ${prettyBytes(total)}`
  if (loaded >= total) row.li.classList.add('done')
}

// Bytes are measured per file; the total is the pinned artifact size, so the
// percentage never moves backwards and is never a guess (PRAC-9).
const dlLoaded = new Map()
function onModelProgress({ row, pct, totalBytes }) {
  updateDownloadRow(row.file, row.loaded, row.total)
  dlLoaded.set(row.file, row.loaded)
  let got = 0
  for (const v of dlLoaded.values()) got += v
  setProgress(pct, `Downloading speech model · ${prettyBytes(got)} of ${prettyBytes(totalBytes)}`)
}

/* ── UI state helpers ──────────────────────────────────── */
function setBusy(busy) {
  running = busy
  els.pick.disabled = busy
  els.language.disabled = busy
  els.timestamps.disabled = busy
  els.copy.disabled = busy
  els.download.disabled = busy
  els.again.disabled = busy
  els.pick.textContent = busy ? 'Starting…' : 'Choose file'
}

function showError(err) {
  const e = err instanceof ScribeError ? err : classify(err, stage)
  els.errorText.textContent = e.message
  els.errorCode.textContent = e.code
  els.error.hidden = false
  els.retry.hidden = !currentFile
  els.status.hidden = true
  els.partial.hidden = true
  stopElapsed()
  logFailure(stage || 'unknown', e)
}

function clearError() {
  els.error.hidden = true
  els.errorText.textContent = ''
  els.errorCode.textContent = ''
  els.retry.hidden = true
}

function showAdvisory(file) {
  const memGb = navigator.deviceMemory
  if (memGb && file.size > memGb * 1024 ** 3 * 0.4) {
    els.advisory.textContent = `Large file (${prettyBytes(file.size)}) on a device reporting ${memGb} GB of memory. If the tab runs out, you will get a message; a shorter clip works best.`
    els.advisory.hidden = false
  } else {
    els.advisory.hidden = true
  }
}

function renderResult(duration, file, language, withTimestamps) {
  els.meta.innerHTML = ''
  const rows = [
    ['File', file.name],
    ['Duration', fmtClock(duration)],
    ['Size', prettyBytes(file.size)],
    ['Language', language === 'auto' ? 'Auto-detected' : `${languageName(language)} (${language})`],
    ['Timestamps', withTimestamps ? 'Per chunk' : 'Off'],
  ]
  for (const [k, v] of rows) {
    const div = document.createElement('div')
    const dt = document.createElement('dt')
    dt.textContent = k
    const dd = document.createElement('dd')
    dd.textContent = v
    div.append(dt, dd)
    els.meta.append(div)
  }
  els.preview.textContent = markdown
  els.result.hidden = false
  els.status.hidden = true
}

/* ── the run (UC-transcribe) ───────────────────────────── */
async function run(file) {
  if (running) return
  setBusy(true)
  clearError()
  els.result.hidden = true
  els.status.hidden = false
  els.partial.hidden = true
  els.partial.textContent = ''
  els.statusNote.textContent = 'The first run downloads the speech model (about 77 MB). It is cached for later visits.'
  resetDownloads()
  dlLoaded.clear()
  stage = null
  for (const li of els.steps.querySelectorAll('li')) li.classList.remove('active', 'done')
  showAdvisory(file)
  currentFile = file
  baseName = baseNameOf(file.name)
  const language = els.language.value
  const withTimestamps = els.timestamps.checked
  const started = performance.now()

  try {
    setStage('decode')
    startElapsed('Extracting audio')
    const { pcm, duration, via } = await extractAudio(file, {
      onFallback: () => {
        startElapsed('Decoding with the fallback decoder (ffmpeg.wasm)')
        els.statusNote.textContent = 'This browser cannot decode the file natively, so the fallback decoder is running.'
      },
      onLog: (msg) => {
        if (/time=/.test(msg)) els.statusNote.textContent = msg.slice(0, 140)
      },
    })
    stopElapsed()
    if (via === 'ffmpeg') els.statusNote.textContent = 'Audio extracted with the fallback decoder.'

    setStage('model')
    const tr = await (async () => {
      setProgress(0, 'Loading speech model')
      try {
        return await loadTranscriber({ onProgress: onModelProgress })
      } catch (err) {
        throw classify(err, 'model')
      }
    })()
    setProgress(100, 'Speech model ready')

    setStage('transcribe')
    const transcribeStart = performance.now()
    els.partial.hidden = false
    const chunks = await transcribeChunked(tr, pcm, {
      language: language === 'auto' ? undefined : language,
      onChunk: ({ done, total, text, endSec }) => {
        const elapsed = (performance.now() - transcribeStart) / 1000
        setProgress((done / total) * 100, `Transcribing · chunk ${done} of ${total} · ${fmtClock(elapsed)} elapsed`)
        els.partial.textContent = text
        els.partial.scrollTop = els.partial.scrollHeight
        els.statusNote.textContent = `Processed ${fmtClock(endSec)} of ${fmtClock(duration)} of audio.`
      },
    })

    setProgress(100, 'Done')
    els.partial.hidden = true
    markdown = buildMarkdown({
      sourceName: file.name,
      chunks,
      duration,
      language,
      withTimestamps,
    })
    els.copy.textContent = 'Copy markdown'
    renderResult(duration, file, language, withTimestamps)
    els.result.scrollIntoView?.({ behavior: 'smooth', block: 'nearest' })
    els.statusNote.textContent = `Finished in ${((performance.now() - started) / 1000).toFixed(0)} s.`
  } catch (err) {
    stopElapsed()
    showError(err)
  } finally {
    stopElapsed()
    setBusy(false)
    els.pick.textContent = 'Choose file'
  }
}

/* ── wiring ────────────────────────────────────────────── */
function openPicker() {
  if (!running) els.file.click()
}

function pickFile(f) {
  if (!f || running) return
  els.fileName.textContent = f.name
  els.fileName.hidden = false
  run(f)
}

els.pick.addEventListener('click', openPicker)
els.file.addEventListener('change', () => {
  const f = els.file.files?.[0]
  els.file.value = ''
  pickFile(f)
})

;['dragenter', 'dragover'].forEach((evt) =>
  els.dropzone.addEventListener(evt, (e) => {
    e.preventDefault()
    els.dropzone.classList.add('dragover')
  }),
)
;['dragleave', 'drop'].forEach((evt) =>
  els.dropzone.addEventListener(evt, (e) => {
    e.preventDefault()
    els.dropzone.classList.remove('dragover')
  }),
)
els.dropzone.addEventListener('drop', (e) => pickFile(e.dataTransfer?.files?.[0]))

els.retry.addEventListener('click', () => {
  if (currentFile) run(currentFile)
})

els.copy.addEventListener('click', async () => {
  const label = 'Copy markdown'
  try {
    await navigator.clipboard.writeText(markdown)
    els.copy.textContent = 'Copied'
    setTimeout(() => (els.copy.textContent = label), 1400)
  } catch (err) {
    showError(fail(CODE.CLIPBOARD, { cause: err }))
  }
})

els.download.addEventListener('click', () => {
  const blob = new Blob([markdown], { type: 'text/markdown;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${baseName}.md`
  document.body.append(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 4000)
})

// UC-restart: the form resets; the model stays loaded in this tab.
els.again.addEventListener('click', () => {
  markdown = ''
  currentFile = null
  els.result.hidden = true
  els.status.hidden = true
  els.advisory.hidden = true
  els.fileName.hidden = true
  els.fileName.textContent = ''
  clearError()
  els.file.value = ''
  els.language.value = 'auto'
  els.timestamps.checked = true
  els.pick.focus()
})

els.language.addEventListener('change', () => {
})

initTheme()
