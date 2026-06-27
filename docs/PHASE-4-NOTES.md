# Phase 4 — Rules engine v1

Status: **complete, pending your review.** Phase 5 (complaint generator + log) won't start until you confirm.

## What shipped

**`rulesEngine.ts`** — each rule is a small typed object
(`{ id, severity, appliesTo, evaluate }`); the engine runs the applicable ones over
a flight and returns triggered `Flag`s. Adding/refining accuracy later = adding or
replacing rule objects; the UI never changes. All thresholds come from `config/`.

- **R1 Operating hours (deterministic).** Compares the current **UK local time**
  (`Intl` `Europe/London`, so GMT/BST is automatic) against the owning airport's
  permitted window for the day type (weekday / weekend / bank holiday — see
  `config/calendar.ts`):
  - Farnborough movement outside its window ⇒ **breach** ("Out of hours").
  - Heathrow/Gatwick inside 23:30–06:00 ⇒ **info** ("Night period") — restricted,
    not banned. Their 24h permitted window means they never trip a breach.
- **R2 Altitude floor (indicative, Farnborough).** Below the ~4,000 ft design
  profile (from `config/corridors.ts`, minus a margin) within 8 nm of the field ⇒
  "Below profile". Reason notes approach traffic is legitimately low.
- **R3 Corridor proximity (indicative).** Lateral offset from the nearest configured
  RNAV centreline beyond tolerance (and within an upper bound, so a clearly-different
  route isn't flagged) ⇒ "Off track". Uses new `distanceToPolylineNm` in `geo.ts`.

**UI**
- `FlagBadge`: **solid rose for breach** (⚠), neutral sky for info, dashed amber +
  "indicative" for indicative.
- Flags shown on each `FlightCard` (next to the airport tag) and in `FlightDetail`
  (each with its one-line reason).
- Map markers tint **rose when a flight has a breach flag**, so they're spottable.
- Footer copy is now the indicative disclaimer (flags are a guide, not proof).

## Definition of Done

| DoD item | State |
|---|---|
| Out-of-hours Farnborough movement flagged reliably | ✅ deterministic R1 → "Out of hours" breach |
| Altitude/corridor flags appear, clearly marked indicative | ✅ R2 "Below profile" & R3 "Off track", dashed + "indicative" |

## Verified

- `npm run build` + typecheck clean (front-end + Worker).
- **Headless browser test with a fixed clock** (23:45 UK, weekday) + stubbed flights:
  Farnborough flight → Out of hours (breach) + Below profile; off-centreline flight →
  also Off track; Heathrow-by-route flight → Night period (info). All four fired;
  reasons rendered; no runtime errors. List + detail screenshots captured.

## Honest limitations / for later

- **Farnborough's exact weekday window (07:00–22:00) is still a placeholder** —
  verify against the 20/00871/REVPP decision notice (config note in `airports.ts`).
- Bank-holiday list is England & Wales 2026–2027 — **update annually**
  (`config/calendar.ts`). Christmas/Boxing-Day "no flying" is treated as the
  weekend window, not a full closure.
- R2/R3 use **seed corridor geometry** (one Rwy 24 SID) — they're deliberately
  indicative; real AIP waypoints land in Phase 6. R3 only flags Farnborough today
  because it's the only airport with a corridor.
- Thresholds (grace 5 min, altitude 8 nm / 500 ft margin, corridor 1.5–5 nm) are
  first guesses, all tunable in `config/rules.ts`.
