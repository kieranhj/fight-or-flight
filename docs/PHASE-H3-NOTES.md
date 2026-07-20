# Phase H3 — History tab: stats vs permits + flight log

Third phase of [`TELEMETRY-CAPTURE-PLAN.md`](./TELEMETRY-CAPTURE-PLAN.md): the
PWA gains a **History** tab over the recorder's nightly D1 summaries.

## What was built

- **`src/config/permits.ts`** — Farnborough movement caps, **verified against
  Rushmoor Borough Council (the planning authority), July 2026**: 50,000
  movements/year total (20/00871/REVPP), 8,900/year weekend + bank holiday (2011
  appeal). Also noted: pending application **25/00615/REV** (Nov 2025) seeks to
  raise the non-weekday cap to 13,500 — the recorded dataset is directly relevant
  evidence for that process.
- **`src/lib/history.ts`** — typed client for `/api/history/stats` and
  `/api/history/flights` (D1 row shapes, 0/1 booleans as numbers).
- **`src/components/HistoryModal.tsx`** — History button in the header opens a
  modal with two tabs:
  - **Stats**: tiles for Farnborough movements vs the 50,000/yr cap, weekend/BH
    movements vs the 8,900/yr cap, likely breaches (rose when non-zero), and
    days recorded; a tappable last-14-days bar strip (tap a bar → day breakdown
    → jump to that day's flights); and an honesty note — counts are
    **minimums** (recording start + coverage gaps) while the caps cover full
    calendar years, with the permit provenance spelled out.
  - **Flights**: day picker (from recorded days) + All / Farnborough / Flagged
    filters; rows show callsign, UK 24h first–last seen times, movement chip
    (e.g. "Farnborough arrival · ground-truth" vs "· inferred"), rule-flag
    badges, altitude band and closest-to-home distance. Tap → detail sheet with
    takeoff/landing times, full telemetry summary and flag reasons.
    Ground-only (parked) sessions are hidden from the list.
- All history times render **Europe/London 24h** regardless of device locale —
  the rules are UK-local, so the display matches the flag reasons.

## Not in this phase (by design)

- Map day-replay / scrubbing — **H4**.
- Repeat-offender aggregation + post-hoc complaint flow — **H5**.
- Weekly/monthly/yearly rollup charts beyond the 14-day strip — worth adding
  once more than a few weeks of data exist.

## Verification performed

Headless Chromium E2E against stubbed history endpoints (14 assertions, all
passing) + screenshot review: tile arithmetic across multi-day stats (95 EGLF
movements, 41 weekend, 1 breach), the cap labels, the minimums note, bar-strip
tap → day caption → "View flights" tab jump, parked-session hiding,
ground-truth vs inferred movement chips, Blackbushe circuit chip, Out of hours
badge, Flagged filter, and the detail sheet's landing time + breach reason.
`npm run build` typecheck clean.
