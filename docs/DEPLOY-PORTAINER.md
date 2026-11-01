# Deploying Scribe on Portainer (PRIN-3)

Scribe is a single stateless container: nginx serving the bundle and the vendored
model. No database, no volumes, no published ports. Caddy reaches it over the
shared `proxy` network.

## 1. Prerequisites

- The image exists in GHCR: `ghcr.io/bulaya-ute/scribe:vX.Y.Z`.
  If the package is private, make it public in the package settings, or add a
  Portainer registry credential for `ghcr.io`.
- Caddy is attached to the external `proxy` network.

## 2. Create the stack

Portainer → **Stacks** → **Add stack** → **Repository**

| Field | Value |
|---|---|
| Repository URL | `https://github.com/bulaya-ute/scribe` |
| Repository reference | `refs/heads/main` |
| Compose path | `docker-compose.yml` |

Copy the contents of `.env.example` into the **Environment variables** section and
set:

- `SCRIBE_VERSION` — the release tag to run (`v1.0.0`, not `latest`)
- `PROXY_NETWORK` — leave `proxy` unless the edge network is named differently

Never paste a compose body into the web editor: PRIN-3 requires the repository path
so the deployed file is the reviewed one.

## 3. Route the hostname

The stack publishes no ports. Caddy proxies to the container name:

```caddyfile
scribe.bulaya.dev {
    encode zstd gzip
    reverse_proxy scribe:80

    header {
        Strict-Transport-Security "max-age=31536000; includeSubDomains"
        X-Content-Type-Options "nosniff"
        Referrer-Policy "strict-origin-when-cross-origin"
        X-Robots-Tag "noindex, nofollow"
        -Server
    }
}
```

Reload Caddy after editing the block.

## 4. Verify

```bash
curl -sS -o /dev/null -w '%{http_code}\n' https://scribe.bulaya.dev/
docker inspect scribe --format '{{.State.Health.Status}} {{.Config.Image}}'
```

Expect `200` and `healthy` with the tag you set. Then run the acceptance set in
`spec/12-verification/acceptance.csv` — at minimum: a 6-second clip end to end,
the model cache hit on reload, and copy/download.

## 5. Rollback

Change `SCRIBE_VERSION` to the previous tag and **Update the stack**. The app is
stateless, so there is nothing to restore.
