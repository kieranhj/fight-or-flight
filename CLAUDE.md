# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

**Fight or Flight** — a mobile-first PWA that, on one tap, lists the nearest aircraft to your
location, flags any that look outside local airport rules (Farnborough EGLF / Heathrow EGLL /
Gatwick EGKK), and prefills an **editable** complaint to the right authority. It **never
auto-submits** — output is always a `mailto:`, copy-paste, or deep-link hand-off. Flags are
deliberately framed as **indicative, not proof**; keep that framing in any complaint/UI text.

The canonical spec and phased roadmap is `docs/BUILD-PLAN.md` (all phases complete); per-phase
implementation notes are in `docs/PHASE-*-NOTES.md`. Work proceeds one phase per PR.

## Commands

```bash
npm install
npm run dev            # front-end on http://localhost:5173 (targets local Worker by default)
npm run worker:dev     # Cloudflare Worker on http://127.0.0.1:8787 — run alongside dev
npm run build          # tsc -b (all project refs) then vite build → ./dist
npm run typecheck      # tsc -b --noEmit
npm run worker:deploy  # wrangler deploy --config worker/wrangler.toml
```

There is **no test runner and no linter** configured — `tsc` (strict, `noUnusedLocals`,
`noUnusedParameters`) is the only automated check. Run `npm run typecheck` before considering
a change done. The front-end needs the Worker running locally to return real data.

## Architecture

Two deployables that must agree on a wire contract:

- **Front-end** (`src/`): Vite + React + TypeScript + Tailwind + Leaflet + `vite-plugin-pwa`.
  Hosted on GitHub Pages at `/fight-or-flight/` (the Vite `base`).
- **Worker** (`worker/src/index.ts`): a single-file Cloudflare Worker. The front-end talks
  **only** to it — it never calls ADS-B feeds directly. The Worker calls `airplanes.live`
  (fallback `adsb.lol`), enriches with route data (`adsbdb.com`), filters → normalizes →
  sorts by distance → trims to N → caches ~8s at the edge, serving last-good data when feeds fail.

### Critical: the NormalizedFlight contract

The `NormalizedFlight` type is **duplicated** in `src/lib/adsb.ts` and `worker/src/index.ts`
(the Worker is intentionally self-contained, with no imports from `src/`). When you change one,
change the other — they are the wire contract between the two deployables.

### Front-end data pipeline

`fetchNearby()` (`src/lib/adsb.ts`) → for each flight, `assessFlight()` (`src/lib/assess.ts`)
runs the two stages:

1. **`classify.ts`** — tags each flight to an owning airport or `transit`/`overflight`/`unknown`.
   Order of evidence: route match (the only "confident" outcome) → known route elsewhere → 
   proximity+altitude → callsign hint → unknown. Anything not pinned down is *labelled*, never guessed.
2. **`rulesEngine.ts`** — runs typed `Rule` objects (R1 hours = deterministic `breach`;
   R2 altitude-floor and R3 corridor = `indicative`) and returns `Flag`s with a severity and
   one-line reason. UK local time (GMT/BST) handled via `Intl.DateTimeFormat('Europe/London')`.

Then `complaint.ts` turns a flight + its assessment into an editable `Complaint`, and `log.ts`
persists submissions to a localStorage incident log (with CSV export).

### Config-driven design

**All thresholds, reference data, and tunables live in `src/config/`, never inlined in logic.**
Refining accuracy means editing config or adding a `Rule` object — the engine and UI stay put.
- `airports.ts` — EGLF/EGLL/EGKK coords, operating hours, complaint channels (sourced/cited inline).
- `rules.ts` / `classification.ts` / `corridors.ts` / `filters.ts` — rule + classify thresholds,
  rough corridor centrelines, category exclusions.
- `calendar.ts` — UK bank holidays (feed R1 hours rule).
- `types.ts`, `api.ts` — shared types and the Worker endpoint resolver.

Farnborough corridor geometry is the **real Farnborough WebTrak swaths** (captured to
`docs/data/webtrak-fab-layers.*`); R2/R3 use point-in-polygon against them (R2 = below a zone's
published altitude band; R3 = inside no published swath). See `docs/CORRIDOR-DATA-EXTRACTION.md`
for the source/endpoint, and `docs/ASCENT-DESCENT-HEURISTIC.md` for the deferred follow-on this unblocks.

## Deploy

- Push to `main` → `.github/workflows/deploy.yml` builds and publishes the front-end to Pages.
  Set the repo Actions **variable** `VITE_WORKER_BASE` to the deployed Worker URL so the built
  site points at it (else it falls back to the local dev address).
- Push touching `worker/**` → `.github/workflows/deploy-worker.yml` deploys the Worker via
  Wrangler (needs repo secrets `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`).
- Optionally lock Worker CORS to your Pages origin via `ALLOWED_ORIGIN` in `worker/wrangler.toml`.

## Build settings note

There are three TypeScript project references (`tsconfig.app.json` for `src/`,
`tsconfig.node.json` for build scripts, `tsconfig.worker.json` for `worker/src/` with
`@cloudflare/workers-types`). `npm run build` builds all via `tsc -b`.
