# UI v2 — verification note

Branch `ui-v2-build`. Built from the stamped spec (110 rows, `spec.py validate --stamp`:
0 errors, 0 warnings, coverage 12/12). Evidence below is what was run on this build,
not claimed. Browser runs used Chromium against `vite preview` (no nginx), plus one
run behind a proxy that applies the exact nginx CSP from `nginx.conf`.

## Build

| check | command | result |
|---|---|---|
| install | `npm install` (lockfile from v1.1.0, `@ffmpeg/core` pinned to 0.12.10) | ok |
| assets | `./scripts/fetch-assets.sh` | all 14 artifacts fetched; every sha256 pin matched |
| build | `npm run build` | ok, 40 modules, `built in ~4 s` |
| unit tests | `npm test` (`tests/markdown.test.mjs`) | 8/8 pass |
| spec | `spec.py validate spec --stamp` | STAMPED, 0 errors |
| practice gate | `practice_check.py src --stack react` | CLEAN: 0 findings |

## External origins

`dist/` audited with `grep -rhoE 'https?://…' dist`. Hits that remain:

- `http://www.apache.org/licenses/LICENSE-2.0`, `https://web.dev/…`, `https://huggingface.co/…`,
  `https://github.com/…`, `https://gist.github.com/…`, `https://developer.mozilla.org/…`,
  `https://emscripten.org/…`: licence and doc comments inside bundled libraries. Not requested at runtime.
- `https://unpkg.com/@ffmpeg/core@0.12.9/…` (in `worker` chunk) and
  `https://cdn.jsdelivr.net/npm/@huggingface/transformers@…` (in transformers.web): the
  libraries' **default** core/wasm locations. Both are overridden at runtime
  (`ff.load({ coreURL: '/ffmpeg/…' })`, `env.backends.onnx.wasm.wasmPaths = '/ort/'`). Not
  reached: the runtime request check below recorded zero non-page origins during native
  and fallback runs. Removing these string literals would require patching the vendored
  libraries; not done.

Runtime check (Chromium, `performance` resource entries): all requests were to
`http://localhost:4173` during a native MP4 run, an AVI (ffmpeg fallback) run and a cached second run.

## Acceptance rows

Key: **V** verified with the evidence shown · **P** partly verified · **N** not verified.

| ACC | status | evidence |
|---|---|---|
| ACC-transcribe-behaviour | V | 6 s MP4 → `# tone clip` markdown with H1, meta quote, H2 Transcript, `**[0:00]** …` line (browser). Only a synthetic 440 Hz tone was available; the transcript text is the model's response to a tone, so this confirms the pipeline, not transcription accuracy. |
| ACC-transcribe-rendered-desktop | P | 1280 px: stage names, `Transcribing · chunk 1 of 1 · 0:05 elapsed` and per-chunk progress observed. Multi-chunk progress (chunk n of m, bar moves per chunk) not observed: test clips were ≤ 6 s (one chunk). No screenshot taken. |
| ACC-transcribe-rendered-tablet | P | 834 px: `scrollWidth == clientWidth` (819 == 819), Choose-file button 44 px. No screenshot. Progress rendering at this width not observed. |
| ACC-transcribe-rendered-mobile | P | 390 px: `scrollWidth == clientWidth` (390 == 390), Choose-file 44 px. No screenshot. Progress rendering at this width not observed. |
| ACC-language | V | `fr` selected → header `language: French (fr)`. Text accuracy in French not checked (tone input). |
| ACC-timestamps | V | timestamps off → single flowing paragraph, no `**[` lines; on → per-chunk `**[m:ss]**` lines (browser runs). Multi-chunk per-paragraph layout not observed (one chunk per test clip). |
| ACC-copy | V | Copy → `navigator.clipboard.writeText` called with the markdown (button label → `Copied`). Clipboard stubbed in the test; real clipboard permission denial path not exercised. |
| ACC-download | V | `Download .md` → blob `text/markdown;charset=utf-8`, 140 bytes; filename `csp-check.md` for input `csp-check.mp4`. |
| ACC-recover-decode | V | AVI (6 s, mp2 audio stream) → `Decoding with the fallback decoder (ffmpeg.wasm)` → `Done` → `(Bell)` transcript. Failure path: non-media `.mkv` → `FLM-decode` with accepted-formats message within 4 s. |
| ACC-restart | V | Start over → result and status hidden, controls enabled; model still loaded (second run after restart made zero model requests). |
| ACC-no-upload | V | Zero requests to origins other than the page origin during native, fallback and cached runs. |
| ACC-cache | V | Second run on the same page: `performance` shows no `models/`, `ort/` or `ffmpeg/` resources. Cache Storage holds `transformers-cache` (7 entries). Timing-based, not a header-level check. |
| ACC-perf | P | 6 s clip: first run 15 s wall incl. model load (Done at 14–15 s), second run with cached model 9 s (Done at 9 s). Measured in the sandbox Chromium host (8 vCPU). The acceptance is "under 30 s on a 4-core machine" — not run on a 4-core machine. |
| ACC-security | P | CSP from `nginx.conf` applied to the page via a local proxy: the run completed under it (no CSP violation blocked the pipeline). Real nginx headers, `nosniff`, `noindex` were **not** checked against the built container (no docker per brief). |
| ACC-theme-system | V | No saved preference: OS dark → `data-theme=dark`, background rgb(14,17,22); OS light → light, rgb(245,246,248). Toggle switches and persists in localStorage; a saved choice survives an OS change. Contrast on measured pairs: light lowest 5.81:1, dark lowest 7.21:1. |

Not checked at all: ACC-transcribe-rendered-* as full progress flows with multi-chunk
media; any screenshot; Firefox and Safari (NFR-compat); ACC-perf on a 4-core machine.

## Known issues (recorded, not fixed)

- `FLM-main-thread-block`: inference blocks the main thread. Observed in the browser:
  the CDP probe timed out during transcription, and the tab later went to `about:blank`
  during an AVI run. Not reproduced as a clean failure; treat as open.
- Vendored `ort-wasm-simd-threaded.jsep.wasm` (21 MB) is also emitted into `dist/assets`
  by Vite via `onnxruntime-web`'s `new URL()`. The runtime uses `/ort/` (`wasmPaths`), so
  the emitted copy is unused. Not removed.
- Chichewa (`ny`) and Bemba (`bem`): not in Whisper base's language tokens. Disabled in the
  UI; see OQ-whisper-languages.

## Re-verification — 2026-11-01 (worker build, ui-v2-build 4d7709c)

Run on the local preview (vite preview, port 4173) in Chromium.

- **FLM-main-thread-block — fixed.** Inference now runs in `src/transcribe.worker.js`.
  During a 75 s, three-chunk run the page answered every poll: 0 unresponsive samples
  over 45 s. Previously the page stalled about 5 s per chunk.
- **RUL-progress / ACC-transcribe-rendered-desktop (partly):** multi-chunk progress
  observed: model download 13→100 %, then "chunk 1 of 3" (33 %) and "chunk 2 of 3"
  (67 %), then Done. Screenshots still not taken.
- **OQ-whisper-languages — decided:** Chichewa and Bemba removed from the UI and
  the code. Offered languages: auto, en, fr, pt, sw, es, de.
- **ACC-no-upload:** origins contacted during the run: only http://localhost:4173.
- **ACC-cache:** Cache Storage holds `transformers-cache`; model downloaded once per page.
- **ACC-restart:** "Start over" hides result and status, clears the file name.
- **ACC-transcribe-behaviour (caveat):** the clip is a synthetic tone, so the output is
  Whisper's repetition, not speech. Accuracy is unverified. The v1.1.1 build gave the
  same text for this clip, so this is not a regression from the worker.
- **Unit tests:** `npm test` → 8/8 pass.
