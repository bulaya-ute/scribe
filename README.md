# Scribe

Turn a video or audio file into a **markdown transcript**, on your own machine.
The file never leaves the browser: audio decoding and speech recognition run in
the tab with WebAssembly.

Live: <https://scribe.bulaya.dev>

## Layout

```
scribe/
├── spec/                  # the stamped spec (13 sub-specs, read-only spec.db)
├── docs/DEPLOY-PORTAINER.md
├── scripts/fetch-assets.sh
├── src/                   # app source (vanilla JS)
├── public/                # favicon, vendored model/ffmpeg/ort (not committed)
├── docker-compose.yml     # Portainer stack — pulls ghcr.io/bulaya-ute/scribe
├── docker-compose.dev.yml # local build override
├── .env.example           # stack variables (copy to the Portainer env form)
└── .github/workflows/     # tag → image release
```

One deployable, one repo: the spec and the deployment live here too (DEC-2).

## Develop

```bash
npm ci
./scripts/fetch-assets.sh   # ~140 MB of pinned, checksum-verified assets
npm run dev
```

`dist/` is built by `npm run build`; the Dockerfile copies it into nginx.

## Release

1. Update `spec/` if behaviour changed, then `spec.py validate --stamp`.
2. `npm version patch` (or minor/major) — bumps `package.json`.
3. Commit, `git tag vX.Y.Z`, `git push --tags`.
4. CI builds and pushes `ghcr.io/bulaya-ute/scribe:vX.Y.Z` and `:latest`.
5. Deploy the tag by setting `SCRIBE_VERSION` in the Portainer stack
   (see `docs/DEPLOY-PORTAINER.md`).

## Known defects

Recorded in the spec, not hidden here:

- Transcription runs on the main thread, so the page stalls for a few seconds per
  30 s chunk. Progress still paints between chunks (`FLM-main-thread-block`).

## Licence

Private project — all rights reserved.
