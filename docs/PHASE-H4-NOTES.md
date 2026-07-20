# Phase H4 — Day replay (timeline scrubber on the map)

Fourth phase of [`TELEMETRY-CAPTURE-PLAN.md`](./TELEMETRY-CAPTURE-PLAN.md):
pick any recorded day and scrub through it, watching every captured aircraft
move on the map.

## What was built

- **Worker `GET /api/history/day/YYYY-MM-DD`** — the day's full NDJSON track
  file. Compacted days stream straight from the immutable R2 day file
  (decompressed through the edge, cached a week). Days still in staging —
  **today**, or yesterday before the 00:15 merge — are merged live from their
  hour + minute objects (≤84 R2 reads, inside the subrequest limit; cached
  60 s). So today's flying is replayable within a minute of it happening.
- **`src/lib/replay.ts`** — parses the track file into per-aircraft sample
  arrays and answers "where was everything at time T": binary search per
  aircraft, **linear interpolation** between samples across gaps ≤90 s, a 120 s
  staleness cutoff, and a 5-minute trail per aircraft.
- **`src/components/ReplayView.tsx`** — third tab in the History modal:
  - Leaflet map reusing the live map's aircraft icons + corridor overlay, with
    a home marker and per-aircraft trails; tap an aircraft for a chip with its
    callsign/type/altitude/speed at the playhead.
  - Timeline slider (15 s steps) + Play/Pause at 1, 5 or 15 replay-minutes per
    second; a live overlay shows the UK time and active-aircraft count.
  - Default playhead: noon UTC when covered, else the end of the data (for
    today that's "just now").
  - The replay day picker includes **today** even before its first nightly
    rollup, so the tab is useful from day one of any deployment.

## Notes

- The full-day file is a few MB compressed; it downloads once per day viewed
  and the browser caches it (immutable for compacted days).
- Parsing ~150–300k records takes ~1–2 s on a phone; the UI shows a loading
  note. If future data volumes make this heavy, a down-sampled replay variant
  can be served server-side.
- Replay renders what the feeds saw — coverage gaps appear as aircraft
  popping in/out, deliberately not papered over (staleness cutoff 120 s).

## Iteration (post-first-use feedback)

- **Slower playback.** Speeds are now 10 s/s, 30 s/s and 1 m/s (default 1 m/s).
  The old 5 m/s and 15 m/s were too fast to follow — scrubbing covers that.
- **Full flight card.** Tapping an aircraft opens the live app's `FlightDetail`
  card (kind tag, likely-airport classification, rule flags, full telemetry —
  distance/bearing from home) — with the classification and hours flags
  evaluated **at the playhead time**, not now, and the complaint button hidden
  (post-hoc complaints arrive properly in H5). Tapping also pauses playback.
- **Group filters.** Chips with per-day counts — Farnborough / Blackbushe /
  Heathrow / Gatwick / Other low / Transit — derived per aircraft from the
  whole track. Ground contact near EGLF/EGLK is decisive; otherwise a track
  endpoint low over any of the four airports (LHR and LGW fields are inside the
  25 nm circle, so their arrivals/departures start/end low there too) counts
  **only with vertical evidence** — climbing out (≥ +200 fpm), descending in
  (≤ −200 fpm), or genuinely very low (≤ 1,500 ft). A LEVEL track that drops
  out of coverage near a field is a dropout, not a landing — this is what
  stopped mid-altitude transits (the NJE869W case) polluting the Farnborough
  filter. The same vertical gate was applied to the nightly rollup's geometry
  fallback so the flights log agrees with replay (re-run
  `/api/history/rollup?day=…` to retro-fix already-rolled days). Otherwise
  ≥4,000 ft throughout → overhead transit; else other low.
- **Heading interpolation.** The aircraft icon's rotation now interpolates
  between samples along the shortest arc (350°→10° passes through north), so
  icons turn smoothly through data gaps instead of snapping.

## Verification performed

Headless Chromium E2E against a stubbed day track (two synthetic aircraft, one
flying a circuit): Replay tab loads and indexes the file; the default playhead
shows the right UK time and active count (1 aircraft at 13:00 UK); scrubbing
the slider to 13:06 activates the second aircraft (marker count 2); tapping a
marker raises the info chip with type/altitude/speed; Play at 5 m/s advanced
the clock 13:06 → 13:12 in ~1.3 s real time and Pause held it. Screenshots
reviewed (corridors, trails, chip, controls). `npm run build` typecheck clean.
