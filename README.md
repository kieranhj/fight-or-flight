# Fight or Flight

A mobile-first PWA that, on one tap, lists the nearest aircraft to your location,
shows their telemetry, flags any that look outside the local rules (Farnborough /
Heathrow / Gatwick), and one-click-generates a prefilled, **editable** complaint
to the right authority. Hosted on GitHub Pages with a Cloudflare Worker data proxy.

> Flags are **indicative, not proof**. The app never auto-submits — it prefills a
> `mailto:` or copy-paste message and hands off to you.

## Stack

- **Front-end**: Vite + React + TypeScript + Tailwind + Leaflet + `vite-plugin-pwa`
- **Proxy**: Cloudflare Worker (TypeScript) via Wrangler — the front-end talks only to it
- **Hosting**: GitHub Pages (front-end) + `*.workers.dev` (Worker)

See [`Aircraft-Complaint-App-Build-Plan.md`](./Aircraft-Complaint-App-Build-Plan.md)
for the full plan and phased roadmap. Work proceeds one phase per PR, stopping at
each phase's Definition of Done for review.

## Status

- **Phase 0 — Scaffold & prove the data path: ✅ done.** See
  [`docs/PHASE-0-NOTES.md`](./docs/PHASE-0-NOTES.md) (incl. the CORS spike: direct
  calls work, but the Worker proxy stays the default).
- **Phase 1 — Nearest-N telemetry (MVP): ✅ done.** Worker calls airplanes.live
  for real (normalize → filter → sort → trim → ~8s cache → adsb.lol fallback);
  one tap → GPS → distance-sorted FlightCards. See
  [`docs/PHASE-1-NOTES.md`](./docs/PHASE-1-NOTES.md).
- **Phase 2 — Map: ✅ done.** Leaflet map with your position + accuracy ring and
  heading-rotated aircraft markers; tap a marker or card for a full telemetry detail
  sheet. See [`docs/PHASE-2-NOTES.md`](./docs/PHASE-2-NOTES.md).
- **Phase 3 — Classification: ✅ done.** Worker enriches flights with adsb.lol route
  data; `classify.ts` tags each as Farnborough/Heathrow/Gatwick (route-confirmed or
  indicative-by-proximity) or transit/unknown — labelled, never guessed. See
  [`docs/PHASE-3-NOTES.md`](./docs/PHASE-3-NOTES.md).
- **Phase 4 — Rules engine v1: ✅ done.** `rulesEngine.ts` runs R1 hours
  (deterministic breach), R2 altitude-floor and R3 corridor (both indicative) over
  each classified flight; `FlagBadge` shows severity + a one-line why. See
  [`docs/PHASE-4-NOTES.md`](./docs/PHASE-4-NOTES.md).
- **Phase 5 — Complaint generator + log: ✅ done.** Two taps from a flight prefill an
  editable complaint to the right authority (`mailto:` / copy + deep link — never
  auto-submitted); each is saved to a localStorage incident log with CSV export. See
  [`docs/PHASE-5-NOTES.md`](./docs/PHASE-5-NOTES.md).
- **Phase 6 — Polish: first pass complete, pending review.** Settings (N, radius,
  units, home-location fallback, complainant details), offline handling, and
  edge-state polish. Two accuracy items (Farnborough exact hours, real AIP corridor
  waypoints) deferred pending data. See [`docs/PHASE-6-NOTES.md`](./docs/PHASE-6-NOTES.md).

## Develop

```bash
npm install
npm run dev            # front-end on http://localhost:5173
npm run worker:dev     # Worker on http://127.0.0.1:8787
```

The dev front-end targets the local Worker by default. Open `/spike.html` to run
the direct-fetch CORS test against airplanes.live.

## Build & deploy

```bash
npm run build          # outputs ./dist (Vite base = /fight-or-flight/)
npm run worker:deploy  # wrangler deploy --config worker/wrangler.toml
```

Pushing to `main` triggers `.github/workflows/deploy.yml` (GitHub Pages). Set the
repo Actions variable `VITE_WORKER_BASE` to your deployed Worker URL so the built
site points at it. One-time setup steps are in the Phase 0 notes.

## Layout

```
src/
  config/   airports, corridors, rules, filters, types, api  (all thresholds live here)
  lib/      adsb client (Worker contract)                     (grows each phase)
worker/
  src/index.ts   Cloudflare Worker: GET /api/nearby (+ /health), CORS
  wrangler.toml
public/spike.html  Phase 0 in-browser CORS spike
.github/workflows/deploy.yml
```

## Data & attribution

Primary feed [airplanes.live](https://airplanes.live), fallback
[adsb.lol](https://adsb.lol) — free, non-commercial, no uptime guarantee. Used
under their terms with attribution. Free ADS-B feeds can miss very low or masked
aircraft.
