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

## Deferred — needs your input

These two from the plan (§6 / §11) need real-world data I shouldn't invent:

1. **Farnborough exact weekday hours** — R1 still uses the `07:00–22:00`
   placeholder. Verify against the **20/00871/REVPP** decision notice (Condition 8)
   and I'll lock it in. The weekend `08:00–20:00` is already solid.
2. **Real RNAV waypoints** for the Rwy 24 SIDs/STARs — R2/R3 use the rough seed
   centreline. Give me the AIP coordinates (or say "go research them") and I'll
   replace the seed geometry and tune the altitude/corridor thresholds.

Everything else in Phase 6 is done; these are accuracy refinements that make the
indicative flags sharper.
