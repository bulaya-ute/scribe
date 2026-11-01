// Audio extraction (UC-transcribe step 2, UC-recover). Everything stays in the tab.
import { CODE, ScribeError, fail, looksLikeOom } from './errors.js'

export const TARGET_RATE = 16000
const FALLBACK_LOAD_MS = 120_000 // watchdog on ffmpeg.wasm start-up

const AudioCtx = () => window.AudioContext || window.webkitAudioContext

// Native path: the browser decodes the container, then we render 16 kHz mono.
async function decodeNative(file) {
  const Ctx = AudioCtx()
  if (!Ctx) throw new Error('AudioContext is not available')
  const ctx = new Ctx()
  try {
    const buf = await ctx.decodeAudioData(await file.arrayBuffer())
    const frames = Math.max(1, Math.ceil(buf.duration * TARGET_RATE))
    const off = new OfflineAudioContext(1, frames, TARGET_RATE)
    const src = off.createBufferSource()
    src.buffer = buf
    src.connect(off.destination)
    src.start(0)
    const rendered = await off.startRendering()
    return { pcm: rendered.getChannelData(0), duration: buf.duration }
  } finally {
    ctx.close?.()
  }
}

function withWatchdog(promise, ms, onTimeout) {
  let timer
  const guard = new Promise((_, reject) => {
    timer = setTimeout(() => reject(onTimeout()), ms)
  })
  return Promise.race([promise, guard]).finally(() => clearTimeout(timer))
}

// Fallback path: ffmpeg.wasm writes a 16 kHz mono WAV, decoded in a 16 kHz context.
// A 48 kHz context here feeds Whisper garbage (FLM-fallback-hang history, v1.1.0).
async function decodeWithFfmpeg(file, { onLog } = {}) {
  if (typeof WebAssembly === 'undefined') throw fail(CODE.WASM_BLOCKED)
  const { FFmpeg } = await import('@ffmpeg/ffmpeg')
  const { fetchFile } = await import('@ffmpeg/util')
  const ff = new FFmpeg()
  ff.on('log', ({ message }) => {
    if (message && onLog) onLog(message)
  })
  // No classWorkerURL: the bundler emits the worker and its imports.
  const execSeconds = Math.min(15 * 60, Math.max(120, (file.size / 1024 ** 2) * 4))
  const hang = (seconds) => fail(CODE.FALLBACK_HANG, { seconds })
  try {
    await withWatchdog(
      ff.load({ coreURL: '/ffmpeg/ffmpeg-core.js', wasmURL: '/ffmpeg/ffmpeg-core.wasm' }),
      FALLBACK_LOAD_MS,
      () => hang(FALLBACK_LOAD_MS / 1000),
    )
    const ext = (file.name.split('.').pop() || 'bin').toLowerCase().replace(/[^a-z0-9]/g, '')
    const inName = `input.${ext || 'bin'}`
    await ff.writeFile(inName, await fetchFile(file))
    const code = await withWatchdog(
      ff.exec(['-i', inName, '-vn', '-ac', '1', '-ar', String(TARGET_RATE), '-f', 'wav', 'out.wav']),
      execSeconds * 1000,
      () => hang(execSeconds),
    )
    if (code !== 0) throw fail(CODE.DECODE, { name: file.name })
    const wav = await ff.readFile('out.wav')
    await ff.deleteFile(inName).catch(() => {})
    await ff.deleteFile('out.wav').catch(() => {})
    const bytes = wav instanceof Uint8Array ? wav : new Uint8Array(wav)
    const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
    const Ctx = AudioCtx()
    const ctx = new Ctx({ sampleRate: TARGET_RATE })
    try {
      const decoded = await ctx.decodeAudioData(ab)
      return { pcm: decoded.getChannelData(0), duration: decoded.duration }
    } finally {
      ctx.close?.()
    }
  } catch (err) {
    if (err instanceof ScribeError) throw err
    if (looksLikeOom(err)) throw fail(CODE.OOM, { name: file.name, size: fmtSize(file.size) })
    throw fail(CODE.DECODE, { name: file.name, cause: err })
  } finally {
    try {
      ff.terminate()
    } catch {
      /* already gone */
    }
  }
}

function fmtSize(n) {
  return n >= 1024 ** 3 ? `${(n / 1024 ** 3).toFixed(1)} GB` : `${(n / 1024 ** 2).toFixed(0)} MB`
}

// Returns { pcm: Float32Array (16 kHz mono), duration, via: 'native' | 'ffmpeg' }.
export async function extractAudio(file, { onFallback, onLog } = {}) {
  let out
  try {
    out = await decodeNative(file)
    out.via = 'native'
  } catch (nativeErr) {
    onFallback?.()
    try {
      out = await decodeWithFfmpeg(file, { onLog })
      out.via = 'ffmpeg'
    } catch (fallbackErr) {
      if (fallbackErr instanceof ScribeError) throw fallbackErr
      throw fail(CODE.DECODE, { name: file.name, cause: fallbackErr })
    }
  }
  if (!out.pcm || out.pcm.length === 0) {
    throw fail(CODE.DECODE, { name: file.name })
  }
  return out
}
