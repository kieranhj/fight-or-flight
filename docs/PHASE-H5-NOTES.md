# Phase H5 — Offenders & post-hoc complaints

Final phase of [`TELEMETRY-CAPTURE-PLAN.md`](./TELEMETRY-CAPTURE-PLAN.md): the
recorded history becomes actionable — repeat offenders surface with evidence,
and any flagged flight can become a complaint after the fact.

## What was built

- **Worker `GET /api/history/offenders?days=N`** — every flagged flight in the
  window (with its flags), plus repeat-offender aggregates **grouped by hex**
  (the stable airframe id; callsigns vary per flight): registration, callsigns
  seen, flagged-flight count, breach/indicative counts, per-rule breakdown,
  first/last day. Sorted breaches-first.
- **Route persistence in the rollup**: the nightly rollup now looks up and
  stores origin/destination (new `origin_*`/`destination_*` columns, migrated
  idempotently) for **airport movements and flagged flights** — bounded at 150
  fresh lookups/night, memoized per callsign, via the same cached/backoff
  `lookupRoute` the proxy uses (injected from index.ts to avoid an import
  cycle). Offender evidence permanently records "arrived from Geneva" even if
  the route DB changes later. The flight sheet prefers the stored route and
  falls back to live lookup for older rows.
- **Offenders tab** in the History modal:
  - Window picker (7/30/90/365 days) + **Export CSV** (day, times, identity,
    movement, route, rules, full flag reasons — evidence-grade, ready to attach
    to a Rushmoor representation).
  - **Repeat offenders by airframe** — expandable cards with breach chips and
    rule breakdowns; inside, the airframe's flagged flights.
  - **All flagged flights** — chronological log; each row has
    **"View in replay →"** (jumps the Replay tab to that day *at the flagged
    moment*) and **"Complain"**.
- **Post-hoc complaints**: `ComplaintModal` gained `when` (the letter and rule
  context use the historical moment — "Tuesday 21 July 2026 at 22:30" — not
  now), `flags` (the **stored D1 flags are cited verbatim** as the evidence,
  rather than re-derived — re-derivation can differ when the reconstructed
  flight lacks position data), and `zClass`. Still never auto-sent; still
  saved to the incident log on copy/send.

## Verification performed

- **Worker, local (wrangler dev + seeded D1)**: re-rollup of the synthetic day
  exercised the column migrations and the route-lookup path (network-blocked →
  graceful nulls); `/api/history/offenders` returned the breach + off-track
  flights with correct aggregates, breaches-first.
- **UI, headless E2E (13 assertions, all passing)**: repeat-offender card
  (2× flagged, breach chip, per-rule counts, both callsigns), stored route
  rendering, card expansion, post-hoc complaint (subject names the flight;
  body carries the **historical** 22:30 date/time and cites the stored breach
  reason verbatim), replay jump landing at 22:30 UK with the offending aircraft
  on the map, and CSV export (filename, header, 3 rows, reasons included).
  Screenshots reviewed. `npm run build` typecheck clean.

## Notes

- Offender identity is per-airframe (hex). Operator-level grouping (e.g. all
  NetJets callsigns) would be a display-layer addition if wanted later.
- The offenders CSV is distinct from the incident-log CSV (that one records
  complaints *made*; this one records flights *flagged*).
- This completes H1–H5 of the telemetry plan. 🛬
