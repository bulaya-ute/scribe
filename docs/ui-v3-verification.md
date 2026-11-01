# UI v3 — verification note

Branch `ui-v3-build`, version 1.3.0. Spec: `spec.py validate spec --stamp` → 112 rows, 0 errors,
0 warnings, coverage 12/12. Evidence below is what was run on this build. Browser checks used
Chromium against the built `dist/` served by `vite preview` on a local port, which was stopped
afterwards at the owner's request. No server is left running and nothing was deployed.

## Build

| check | command | result |
|---|---|---|
| install | `npm install` | ok |
| assets | `./scripts/fetch-assets.sh` | all artifacts fetched; every pinned sha256 matched |
| build | `npm run build` | ok (`built in ~4 s`) |
| tests | `npm test` | 13/13 pass (8 markdown/audio + 5 error-message) |

## Fixed defects

**1. Error banner with no message or code — fixed, verified.**
Every failure now shows a message that names what failed and what to do, plus `Support code:`.
Causes are carried through (`Cause: …`) where the browser gave one.
- Browser: dropping a non-media `broken clip.mkv` gave the `FLM-decode` message ("This browser
  could not read the audio in broken clip.mkv … Accepted formats: MP4 …") with the code shown and
  Try again visible.
- Unit: `tests/errors.test.mjs` checks every code has a non-generic message, that model errors
  include the real cause text, and that long causes are capped.

**2. Download enabled before a transcript exists — fixed, verified.**
Copy, Download and Start over are hidden until a transcript exists and are disabled during a run.
Copy/Download are never enabled on an error screen.
- Browser, initial state: `#actions` hidden, Copy and Download disabled.
- Browser, error state (`FLM-decode`): actions hidden, Copy and Download disabled.
- Browser, after a successful run on `tone.mp4`: Copy and Download enabled, actions `display:flex`.

**3. Action buttons not on one row — fixed on desktop and tablet, verified; phone stacks by design.**
Copy, Download and Start over are one `role="group"` container.
- Browser, after a run: all three buttons share the same `top` at 1920, 1280 and 834 px
  (574/574/574 and 550/550/550), and each is 46 px high.
- At 390 px the three buttons stack full-width, one per row, each 44 px or taller.

**4. Card too narrow on wide desktop — partly fixed, not fully verified.**
- Before: the 1120 px page cap gave a 1040 px card, 54% of a 1920 px window.
- Interim build (1440 px page cap): 1360 px card at 1920 px, which is 71%. Still too narrow.
- Final build: page cap raised to 1600 px and the card gets wider padding at ≥1600 px. The
  transcript text is capped at `max-width: 80ch`, so reading stays readable.
- **Not verified:** the final 1600 px build was not measured in a browser. The browser session
  failed while reading stylesheets, and the preview server was stopped before a re-measure.
  Expected card width at 1920 px is about 1500 px (about 78%); that is a calculation, not a
  measurement.

## Other requirements

- Language select: `auto, en, fr, pt, sw, es, de` only. `ny` and `bem` removed from the UI and
  from `SET-language`; OQ-whisper-languages answered (owner brief).
- Progress: stage names, `chunk n of m`, elapsed time, partial text, no ETA. The model download
  is measured against known byte sizes. Verified: the run shows the download as 31 → 63 → 76 MB
  of 76 MB, then `Speech model ready`, then `Done`.
- Full run: `tone.mp4` (6 s, synthetic tone) produced `# tone` with the H1, meta quote, H2 and
  a `**[0:00]**` paragraph. This confirms the pipeline. It does not confirm transcription accuracy.
- Theme: `prefers-color-scheme` default and a visible toggle stored in localStorage (code path
  from v2; re-verified only by reading the code in this build).
- Footer shows `v1.3.0` from `package.json` through the `__APP_VERSION__` define. Verified.
- Fonts: system stack only; no Google Fonts.

## External origins (dist/)

`grep` over `dist/` found only licence and documentation strings in bundled libraries, plus two
library default URLs that the app overrides at runtime:
- `https://unpkg.com/@ffmpeg/core@0.12.9/…` (default core location; the app passes
  `coreURL: '/ffmpeg/ffmpeg-core.js'`).
- `https://cdn.jsdelivr.net/npm/@huggingface/transformers@…` (default location; the app sets
  `localModelPath` and `wasmPaths`).
Neither is requested in the verified runs. A runtime request count from the browser was not
recorded in this session, so ACC-no-upload is **not verified** here.

## Not verified

- Full acceptance set: the multi-chunk progress flow on a file longer than 30 s (test clips were
  6 s, so only one chunk ran).
- Rendered acceptance at tablet and mobile widths with a transcript present: only layout
  measurements were taken, with no screenshots.
- Zero external requests during a run (ACC-no-upload) and the cache check (ACC-cache).
- ACC-perf on a 4-core machine; the sandbox has more cores.
- ACC-copy clipboard success path and the denied-permission path.
- ACC-security headers: `nginx.conf` was not run; no docker, per the brief.
- Firefox and Safari (NFR-compat).
- FLM-main-thread-block: the worker design is in place, but the responsiveness during a run was
  not re-measured on this build.
- The 1600 px card width (see defect 4).
