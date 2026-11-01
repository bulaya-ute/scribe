# Changelog

## v1.2.0 — 2026-11-01

**Rebuilt from the spec (ui-v2).** The app source is rewritten against the stamped
spec, not carried over from v1.1.x. The v1.1.1 behaviour is kept where the spec
requires it; the rest is new.

- Light and dark themes, following the OS by default, with a toggle that persists
  in localStorage (RUL-theme-system, DEC-theme-system).
- Progress names the stage and shows measured work: download bytes over the pinned
  total, `chunk n of m` with elapsed time, partial text per chunk. No time-remaining
  estimate (RUL-progress).
- Errors name the failure and the next action; each carries its FLM code
  (RUL-honest-errors).
- Language `ny` and `bem` are disabled: Whisper base has no token for them
  (OQ-whisper-languages).
- Verification note: `docs/ui-v2-verification.md`.

**Known**
- Inference still runs on the main thread (FLM-main-thread-block).
- The bundle includes an unused copy of the ONNX runtime wasm (21 MB); the runtime loads `/ort/`.

## v1.1.1 — 2026-11-01

**Touch targets.** Choose file, Language and Include timestamps are 44 px high
(was 42 px), meeting the target size in `spec/10-ui/ui-conventions.md`.

## v1.1.0 — 2026-11-01

**You can see it working.** Transcription is now chunked (30 s, 3 s overlap) with
progress measured from completed chunks: `chunk n of m`, percentage, elapsed time,
and the transcript filling in as each chunk lands. The model download bar is
measured against the known artifact sizes, so it no longer moves backwards when
the decoder starts streaming after the encoder.

**Fixed**
- The ffmpeg.wasm fallback hung forever: the worker was hand-copied without its
  imports. The bundler now emits it, decoding is pinned to 16 kHz (it was
  resampling to 48 kHz and feeding Whisper noise), and both load and exec have
  watchdogs that fail with a message instead of waiting.
- The 500 MB cap is gone, per DEC-no-size-cap: a large file is attempted, with a
  device-memory advisory instead of a refusal.
- The footer shows the build version (PRIN-2).

**Known**
- Inference still runs on the main thread: a 30 s chunk blocks painting for ~5 s.
  Updates paint between chunks (FLM-main-thread-block).

## v1.0.0 — 2026-11-01

First packaged release: static bundle, spec moved into the repo, Portainer stack
and GHCR image.
