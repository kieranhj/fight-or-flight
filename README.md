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

See [`docs/BUILD-PLAN.md`](./docs/BUILD-PLAN.md) for the original plan and phased
roadmap (all phases complete). Work proceeded one phase per PR, stopping at each
phase's Definition of Done for review.

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
- **Phase 6 — Polish: ✅ done.** Settings (N, radius, units, home-location fallback,
  complainant details), offline handling, and edge-state polish. Both deferred
  accuracy items resolved: Farnborough operating hours confirmed, and the corridor
  geometry replaced with the real Farnborough WebTrak swaths (point-in-polygon R2/R3).
  See [`docs/PHASE-6-NOTES.md`](./docs/PHASE-6-NOTES.md) and
  [`docs/CORRIDOR-DATA-EXTRACTION.md`](./docs/CORRIDOR-DATA-EXTRACTION.md).

### Beyond the plan

- **Real Farnborough corridors.** Seed centrelines replaced with the published
  Farnborough **WebTrak** swaths (arrival + departure), captured to
  [`docs/data/`](./docs/data) and consumed by R2/R3 via point-in-polygon. See
  [`docs/CORRIDOR-DATA-EXTRACTION.md`](./docs/CORRIDOR-DATA-EXTRACTION.md).
- **Farnborough trajectory heuristic.** Route-less business jets are inferred as
  arriving/departing Farnborough from descent/climb + corridor alignment, catching
  inbound/outbound jets the route DB misses. See
  [`docs/ASCENT-DESCENT-HEURISTIC.md`](./docs/ASCENT-DESCENT-HEURISTIC.md).
- **Blackbushe (EGLK).** Added as a fourth airport. A per-airport ADS-B size band and
  terminal radius attribute light GA near Farnborough to Blackbushe, and leave
  low-and-far hobbyist traffic unattributed rather than false-positiving Farnborough.
- **Map & display.** Per-kind corridor overlay toggles (departure / arrival), an
  optional "re-centre on refresh" toggle, and very-low unknown-category aircraft drawn
  as light rather than full-size.
- **Continuous telemetry recorder (H1).** The Worker's cron triggers record every
  aircraft within 25 nm of home to R2 (15 s cadence, gzipped NDJSON, minute→hour→day
  compaction) for later analysis: Farnborough movement stats vs permits, day replay,
  offender tagging. See [`docs/TELEMETRY-CAPTURE-PLAN.md`](./docs/TELEMETRY-CAPTURE-PLAN.md)
  and [`docs/PHASE-H1-NOTES.md`](./docs/PHASE-H1-NOTES.md).
- **Nightly flight summaries (H2).** The nightly cron sessionizes each day's capture
  into D1: one row per flight, EGLF/EGLK movements ground-truthed from on-ground
  samples (geometry fallback when coverage misses the ground segment), R1/R2/R3
  rule flags evaluated at the logged times, and daily stats — queryable via
  `/api/history/flights` + `/api/history/stats`. See
  [`docs/PHASE-H2-NOTES.md`](./docs/PHASE-H2-NOTES.md).
- **History tab (H3).** Stats vs the verified Farnborough permit caps (50,000/yr;
  8,900 weekend/BH — Rushmoor BC, with the pending 25/00615/REV increase noted), a
  tappable daily movements strip, and a per-day flight log with Farnborough/Flagged
  filters and full detail sheets. See [`docs/PHASE-H3-NOTES.md`](./docs/PHASE-H3-NOTES.md).
- **Incident-log review.** Import an incident-log CSV (or review your own saved log),
  scroll the list or view it on the map, and tap any entry to re-run the classifier and
  rules **at the logged time** — double-checking what the heuristics decided (owning
  airport with a *matches / differs from recorded* indicator, hours, arrival/departure,
  corridor inside/outside, route, recomputed flags). The CSV export now also captures
  track / category / speed / vertical rate / nav-alt / route / military so future logs
  support the full re-analysis.

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
  config/   airports (incl. Blackbushe), corridors (WebTrak swaths), rules,
            classification, calendar, filters, types, api   (all thresholds live here)
  lib/      adsb (Worker contract), classify, trajectory, rulesEngine,
            assess, complaint, geo, aircraft, log, incidentCsv, review, settings, …
  components/  NearbyButton, FlightList/Card/Detail, MapView, FlagBadge,
               AirportTag, KindTag, ComplaintModal, IncidentLog,
               Review{Modal,Map,Detail}, Settings*
worker/
  src/index.ts   Cloudflare Worker: GET /api/nearby (+ /health, /api/history/*), CORS
  src/capture.ts telemetry recorder (cron: capture → R2, compaction)
  src/shared.ts  upstream feed access shared by proxy + recorder
  wrangler.toml  cron triggers + R2 binding
docs/        BUILD-PLAN, PHASE-*-NOTES, DATA-RESEARCH, CORRIDOR-DATA-EXTRACTION,
             ASCENT-DESCENT-HEURISTIC, data/ (captured WebTrak swaths)
public/spike.html  Phase 0 in-browser CORS spike
.github/workflows/  deploy.yml (Pages) · deploy-worker.yml (Wrangler)
```

## Data & attribution

Primary feed [airplanes.live](https://airplanes.live), fallback
[adsb.lol](https://adsb.lol); route enrichment via [adsbdb.com](https://www.adsbdb.com).
Farnborough corridor geometry from **Farnborough WebTrak** (EMS Brüel & Kjær /
Envirosuite). All free / non-commercial, no uptime guarantee, used under their terms
with attribution. Free ADS-B feeds can miss very low or masked aircraft.
