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

**Expected outcome & decision:** the community ADS-B feeds are documented as
rate-limited (~1 req/s) and not reliably CORS-enabled, which is exactly why the
build plan makes the **Worker proxy the default**. We proceed on the proxy
regardless of the spike result:

- If the spike says **BLOCKED** → proxy is required. (Expected.)
- If the spike says **SUCCESS** → the Worker becomes an optional cache /
  rate-limit-smoothing / enrichment layer, but we still route through it so we
  keep one code path, server-side route enrichment (Phase 3), and a place to
  hide any future API key.

Please run the spike and tell me the result — it's recorded here either way, but
it doesn't block Phase 1's design.

## Definition of Done

| DoD item | State |
|---|---|
| Blank app deploys to `https://kieranhj.github.io/fight-or-flight/` | Workflow ready; deploys on push to `main` (needs Pages enabled, see below). |
| Worker reachable | `GET /api/nearby` + `/health` verified locally with CORS headers; deploy with `npm run worker:deploy`. |
| CORS decision documented | This file. Proxy is the default; browser spike page provided for the empirical check. |

## To finish wiring (one-time, needs your GitHub/Cloudflare access)

1. **Enable Pages**: repo *Settings → Pages → Build and deployment → Source =
   GitHub Actions*. Then merge this to `main` (or run the workflow) to publish.
2. **Deploy the Worker**: `npx wrangler login && npm run worker:deploy`.
3. **Point the site at the Worker**: set repo *Settings → Secrets and variables
   → Actions → Variables → `VITE_WORKER_BASE`* to the deployed
   `https://aircraft-complaint-proxy.<account>.workers.dev` URL, then re-run the
   deploy. (Until then the built site targets the local dev Worker address.)

## Verified locally

- `npm run build` → clean (tsc project build + Vite + PWA precache).
- Worker: `/health`, `/api/nearby` (CORS headers + stub body), `OPTIONS` 204 preflight.
- PWA manifest `scope`/`start_url` = `/fight-or-flight/`; icons (192/512/maskable) generated.
