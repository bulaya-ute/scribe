# UI conventions

Binding choices for this spec (PRAC-9). One screen, so the table is short, but
every pattern named here is the one the build uses — no one-off variants.

## Loading and progress

| where | pattern | why |
|---|---|---|
| model download | **progress with stages**, one aggregate bar over known bytes, plus one row per artifact (encoder, decoder, tokenizer) with its own byte counter | the total is known (bytes), so a percentage is measured, not guessed |
| transcription | **progress with stages**, bar derived from completed chunks, label `Transcribing · chunk n of m`, elapsed time shown | chunk count is measured work; no ETA is invented |
| partial transcript | the preview area accumulates text as each chunk finishes | long runs must show something real, not a spinner |
| fallback decode (ffmpeg) | **progress with stages**, stage named, indeterminate bar with elapsed time | ffmpeg reports no reliable byte/step total for the exec |
| first paint | nothing for the first ~300 ms; once a stage is shown it stays ≥300 ms | no flicker on fast operations |

**Never:** stage weights guessed to fill a bar; a percentage that can move backwards;
a blank panel with no stage name while work is running.

## Controls

- Busy controls disable and label themselves (`Starting…`), never spin without text.
- Every error names the cause and the next action; no bare "Something went wrong".
- Interactive targets ≥44 px; focus visible; the progress region carries `aria-live="polite"`.

## Layout

- One card, one primary action at a time. Desktop (≥1024 px): page max-width 1600 px so the
  window width is used; transcript preview capped at about 80 characters per line
  (DEC-ui-v3-layout). Tablet and phone: fluid, full width inside the page margin.
- Transcript actions (Copy, Download .md, Start over) form one aligned group and exist only
  once a transcript exists (DEC-ui-v3-actions).
- Device classes: desktop (≥1024), tablet (768–1023), mobile (<768) — the same
  information must be visible at all three without horizontal scrolling.

## Theme

- Light and dark (`manifest.csv: themes=system`, RUL-theme-system, DEC-theme-system).
  The OS preference is the default; the visible toggle in the top bar stores the
  visitor's choice in localStorage, which then overrides the OS setting.
- Both themes meet 4.5:1 for body text. Measured 2026-11-01 in Chromium: light
  lowest 5.81:1, dark lowest 7.21:1 on the measured pairs.
- The earlier POL-themes wish is closed by DEC-theme-system (promoted to requirement).
