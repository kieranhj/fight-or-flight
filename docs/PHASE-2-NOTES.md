# Phase 2 — Map

Status: **complete, pending your review.** Phase 3 (classification) won't start until you confirm.

## What shipped

- **`MapView`** (Leaflet via `react-leaflet`, OpenStreetMap tiles):
  - Your position as a marker with an **accuracy ring** (`Circle`, radius = GPS accuracy in metres).
  - **Aircraft markers rotated to `track`** — a `divIcon` carrying an inline SVG plane that points north at 0° and is CSS-rotated by the flight's heading (no default Leaflet icon assets, so nothing to break under bundling).
  - Auto-fits the view to show you + all plotted aircraft; selected marker turns sky-blue and rises to the top.
- **`FlightDetail`** bottom sheet — full telemetry for the tapped flight (distance, bearing, baro/geom altitude, ground speed, vertical rate, track, selected altitude, squawk, category, hex, lat/lon), with the indicative caveat.
- **List/Map toggle** in `App`; selection is shared — tapping a **map marker** *or* a **list card** opens the same detail sheet.
- Attribution added for OpenStreetMap alongside the ADS-B feeds.

## Definition of Done

| DoD item | State |
|---|---|
| Map shows you and the nearby aircraft | ✅ user dot + accuracy ring + heading-rotated plane markers |
| Selection works | ✅ tap a marker or card → detail sheet; selected marker highlights |

## Verified

- `npm run build` + typecheck clean (front-end + Worker).
- **Headless browser smoke test** (Chromium, stubbed API + simulated GPS): list
  renders sorted with telemetry; **2 plane markers** plot on the map; tapping a
  marker opens the detail dialog for the right flight; no JS/Leaflet runtime
  errors (only the OSM tile fetches fail in the offline sandbox — they load on a
  real device). Screenshots captured for map + detail views.

## Notes / for later

- Map tiles are network-only for now; offline tile/shell caching is Phase 6.
- Leaflet adds ~140 KB to the bundle; if it matters we can lazy-load `MapView`
  (code-split) in the Phase 6 polish pass so the list-only path stays light.
- Markers re-fit bounds whenever results change; if that ever feels jumpy during
  refresh we can fit only on first load.
