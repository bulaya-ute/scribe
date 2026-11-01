# Scribe — summary

Scribe turns a video or audio file into a markdown transcript **without uploading it**.
The visitor drops a file; the browser decodes the audio track, transcribes it with a
quantised Whisper model through WebAssembly, and assembles the markdown in the page.

The server is a static bundle: nginx serving the app, the vendored model and the
wasm runtimes. It has no API, no database, no accounts and no persistence — the only
state that survives a visit is the browser's model cache.

**Scale:** solo lane — the service is deployed, public and multi-session, so the spec
standard applies rather than the one-shot path.

**Audiences:** a visitor with a recording; a maintainer who publishes builds and keeps
the vendored assets current.

**Out of scope:** URL fetching, server uploads, accounts, in-app editing, speaker
separation (deferred), WebGPU (deferred), interface translation (deferred).

**Known gap at the time of writing:** the ffmpeg.wasm fallback decoder engages for
containers the browser cannot decode but never completes (`FLM-fallback-hang`), so
`ACC-recover-decode` currently fails.
