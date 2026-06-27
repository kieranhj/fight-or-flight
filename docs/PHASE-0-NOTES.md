# Phase 0 — Scaffold & prove the data path

Status: **complete, pending your review.** Per the build plan, Phase 1 will not start until you confirm.

## What shipped

- **Front-end**: Vite + React + TypeScript + Tailwind, installable PWA via
  `vite-plugin-pwa`. `base` is set to `/fight-or-flight/` (the repo name) so it
  serves correctly from GitHub Pages.
- **Config seed** (`/src/config`): `airports.ts`, `corridors.ts`, `rules.ts`,
  `filters.ts`, `types.ts`, `api.ts` — populated from build-plan §7. All
  thresholds and corridor geometry live here, never inline in logic.
- **Worker** (`/worker`): Cloudflare Worker in TypeScript. `GET /api/nearby`
  returns a hard-coded normalized sample with permissive CORS; `OPTIONS`
  preflight and `/health` implemented. Deploy via `npm run worker:deploy`.
- **CI/CD**: `.github/workflows/deploy.yml` builds and deploys to GitHub Pages
  on push to `main`. Worker deploys separately via Wrangler.
- **Spike page**: `public/spike.html` (served at `/fight-or-flight/spike.html`)
  runs the real in-browser direct-fetch CORS test.

The landing page states up front that flags are **indicative, not proof**, lists
the honest constraints, and has a "Check Worker /api/nearby" button proving the
data path end to end.

## CORS spike result

**Goal:** does `https://api.airplanes.live/v2/point/{lat}/{lon}/{radius}` work
from a browser `fetch()`, or does CORS block it?

**What I could test from this build environment:** nothing conclusive — this
sandbox's network policy blocks the host outright (the agent proxy returns
`403` on `CONNECT api.airplanes.live:443`), so no server-side curl can observe
the upstream's CORS headers. The empirical browser test therefore has to run
from a real browser.

**How to get the definitive answer (1 minute):** once deployed, open
`https://kieranhj.github.io/fight-or-flight/spike.html` on your phone or
desktop and tap **Run direct fetch**. It reports SUCCESS (CORS allowed) or
BLOCKED (no `Access-Control-Allow-Origin`). You can also run it locally with
`npm run dev` → open `/spike.html`.

**Empirical result (run from the deployed spike page):** **SUCCESS — CORS
allowed.** A direct browser `fetch()` to
`https://api.airplanes.live/v2/point/{lat}/{lon}/{radius}` returns 200 with a
usable body; the feed sends a permissive `Access-Control-Allow-Origin`, so the
browser does not block it.

**Decision: keep the Worker proxy as the default anyway.** Direct calls working
makes the Worker *optional* for raw fetches, but we still route the front-end
through it because it earns its place on the other three problems the build plan
called out:

- **Rate limits** — airplanes.live is ~1 req/s; the Worker's ~8s edge cache
  smooths bursts and shields the feed (and us) from throttling.
- **Route enrichment (Phase 3)** — adsb.lol `routeset` lookups are cleaner
  batched server-side than fanned out from the browser.
- **Future API keys / fallback** — the Worker is the one place to hide a key and
  to fail over to adsb.lol, keeping a single front-end code path.

So the spike result is good news (no hard CORS dependency, and a viable
direct-call fallback if the Worker ever has issues), but it does **not** change
the architecture: front-end → Worker → feeds.

## Definition of Done

| DoD item | State |
|---|---|
| Blank app deploys to `https://kieranhj.github.io/fight-or-flight/` | ✅ Deployed via GitHub Actions on push to `main`. |
| Worker reachable | ✅ Deployed to `https://aircraft-complaint-proxy.kieranhj.workers.dev` (CI via Wrangler); `/health` + `/api/nearby` serve with CORS. |
| CORS decision documented | ✅ Spike returned **SUCCESS** (direct calls allowed); Worker proxy kept as default for rate-limit/enrichment/fallback. See above. |

## How it was wired up (record of the one-time setup)

1. **Pages**: repo *Settings → Pages → Source = GitHub Actions*; deploys on push
   to `main` via `.github/workflows/deploy.yml`.
2. **Worker**: deployed from CI by `.github/workflows/deploy-worker.yml` using a
   Cloudflare API token (`CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID` repo
   secrets) — no local `wrangler login` needed. Required registering the
   account's workers.dev subdomain (`kieranhj`) once in the Cloudflare dashboard.
3. **Site → Worker link**: repo *Settings → Secrets and variables → Actions →
   Variables → `VITE_WORKER_BASE`* set to
   `https://aircraft-complaint-proxy.kieranhj.workers.dev`, then re-run the Pages
   deploy. The Worker base is resolved robustly (empty → localhost fallback,
   scheme auto-prepended, trailing slash stripped) in `src/config/api.ts`.

## Verified locally

- `npm run build` → clean (tsc project build + Vite + PWA precache).
- Worker: `/health`, `/api/nearby` (CORS headers + stub body), `OPTIONS` 204 preflight.
- PWA manifest `scope`/`start_url` = `/fight-or-flight/`; icons (192/512/maskable) generated.
