# Changelog

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
