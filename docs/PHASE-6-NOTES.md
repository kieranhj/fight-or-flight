# Phase 6 — Polish

Status: **first pass complete, pending your review.** Two data-accuracy items are
deferred because they need your input (see "Deferred" below).

## What shipped

**Settings** (`settings.ts` + `SettingsModal` + `SettingsContext`)
- **Aircraft to show (N)** and **search radius** sliders — fed into the Worker query.
- **Units**: altitude ft/m, distance nm/km, speed kt/km·h — applied live across the
  list, detail sheet and incident log (via a settings context). CSV export stays
  canonical (ft/nm) for a consistent evidence base.
- **Location**: Device GPS or fixed Home coordinates, with a "fall back to home if
  GPS is unavailable" toggle and editable home lat/lon (seeded from config).
- **Your details** (name/address/postcode) now live here too, persisted to
  localStorage — the dedicated entry point we discussed.
- All settings persist across reloads.

**Offline / PWA**
- Installable PWA with precached app shell was already wired (vite-plugin-pwa);
  this adds graceful offline handling: an **offline banner**, a clear message, and
  an early "you're offline" state when you try to fetch without a connection.

**Edge states** — tightened: no-aircraft empty state, friendly GPS
permission/timeout errors, feeds-unavailable / stale handling, and now offline.

**Attribution** — airplanes.live / adsb.lol / OpenStreetMap credited in the footer.

## Definition of Done (plan §6)

| Item | State |
|---|---|
| PWA install + offline shell | ✅ installable; shell precached; offline banner + state |
| Settings (N, radius, home fallback, units) | ✅ all present + persisted |
| Empty / error / no-GPS states | ✅ covered |
| Attribution | ✅ in footer |
| Refine corridor geometry + tune thresholds | ⏳ **deferred — needs data (below)** |

## Verified

- `npm run build` + typecheck clean (front-end + Worker).
- **Headless browser test (10 assertions):** units convert live (2,500 ft → 762 m,
  1.2 nm → 2.2 km); N/radius feed the request (`radius=20&n=5`); home mode uses the
  home lat (51.188) instead of device GPS (51.5); settings persist across reload;
  offline banner appears. No runtime errors. Settings panel screenshot captured.

## Data accuracy follow-up (researched — see `DATA-RESEARCH.md`)

1. **Farnborough hours — CONFIRMED ✅.** Weekdays 07:00–22:00; weekends/bank
   holidays 08:00–20:00; no flying Christmas/Boxing Day — Condition 8 of
   20/00871/REVPP, cross-checked against Rushmoor BC and the airport FAQ. The
   config values already matched; the "placeholder/verify" caveat is removed.
2. **Rwy 24 corridor — partially confirmed ⚠️.** SID names (GWC 2F / HAZEL 2F) and
   the ≥4,000 ft over the A31 Hog's Back are confirmed; the exact RNAV **waypoint
   coordinates** are in access-gated AIP/chart sources (403 to automated fetch) and
   were **not** fabricated. The centreline stays a documented approximation —
   replace with AIP fixes when available. R3 remains labelled indicative.
