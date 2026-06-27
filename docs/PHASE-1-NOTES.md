# Phase 1 — Nearest-N telemetry (MVP)

Status: **complete, pending your review.** Phase 2 (map) won't start until you confirm.

## What shipped

**Worker — real `/api/nearby`** (`worker/src/index.ts`)
- Calls `api.airplanes.live/v2/point/{lat}/{lon}/{radius}`; on any error/non-200,
  falls back to `api.adsb.lol` (same ADSBExchange-v2 format).
- **Exclusion filters** (mirror of `src/config/filters.ts`): drops military
  (`dbFlags` bit 0), rotorcraft (`A7`) and light GA (`A1`); keeps the rest.
- **Normalizes** raw fields → `NormalizedFlight` (callsign trimmed, `alt_baro:
  "ground"` → `onGround`, vertical rate from `baro_rate`/`geom_rate`, nav alt
  from `nav_altitude_mcp`/`_fms`, `dst`/`dir` → distance/bearing).
- **Sorts by distance** (nulls last), **trims to N**.
- **Caches ~8s** at the edge (Cloudflare Cache API, keyed on position rounded to
  3 dp so nearby taps share a result) plus `cf: { cacheTtl: 8 }` on the upstream
  fetch and `Cache-Control: max-age=8` on the response.
- Validates input: missing/blank/out-of-range `lat`/`lon` → `400`; `radius`
  clamped 1–250 nm, `n` clamped 1–50. Both feeds down → `502`. CORS on every path.

**Front-end — one-tap identify** (`src/`)
- `App.tsx` state machine: idle → locating (`getCurrentPosition`) → loading
  (`fetchNearby`) → ready / error, with abort on re-tap.
- `components/NearbyButton` (primary action, spinner + status labels),
  `components/FlightList` (sorted cards, empty state, source/accuracy/updated
  footer), `components/FlightCard` (title = callsign→reg→hex; type · reg;
  distance + bearing; altitude, speed, vertical rate with climb/descend colour).
- `lib/geolocation.ts` (typed GPS wrapper with friendly permission/timeout
  errors), `lib/format.ts` (telemetry formatters incl. 16-point compass bearing).

## Definition of Done

| DoD item | State |
|---|---|
| One tap → sorted, filtered list of **real** nearby aircraft with telemetry | ✅ in code; **needs your on-phone check against live data** (see below). |

## How to verify on your phone

1. Merge this and let **Deploy to GitHub Pages** + **Deploy Worker** run.
2. Open `https://kieranhj.github.io/fight-or-flight/`, tap **Identify aircraft
   now**, allow location. You should get a distance-sorted list of jets with
   altitude / speed / vertical rate / distance / bearing.
3. Sanity-check directly:
   `https://aircraft-complaint-proxy.kieranhj.workers.dev/api/nearby?lat=51.188&lon=-0.802&radius=10&n=8`
   → JSON with a `flights` array and `source: "airplanes.live"`.

## Honest limitations / things to watch

- **I could not exercise the live data path from the build sandbox** — its
  network policy blocks both feeds (verified the Worker returns a clean `502`
  with CORS when upstreams are unreachable, and all input-validation paths). The
  real fetch/normalize is exercised first on your phone.
- **Field-mapping assumptions** (ADSBExchange-v2): if a value looks off on real
  data (e.g. nav altitude, vertical rate, or a type/category that should/should
  not be filtered), tell me what you see and I'll adjust the normalizer/filters.
- On-ground aircraft (`alt_baro: "ground"`) are filtered out — the app targets
  overhead noise, so parked/taxiing traffic is clutter. Toggle via
  `EXCLUDE_ON_GROUND` in `src/config/filters.ts` (mirrored in the Worker). The
  `FlightCard` still renders an “On ground” state in case the flag is disabled.
- No auto-refresh yet (tap **Refresh** to re-poll) — that's Phase 6 polish.
