# Phase 3 — Classification (which airport)

Status: **complete, pending your review.** Phase 4 (rules engine) won't start until you confirm.

## What shipped

**Worker — route enrichment**
- After filter/sort/trim, the Worker makes **one batched** `POST adsb.lol/api/0/routeset`
  call for the ≤ N returned flights (those with a callsign + position) and attaches
  origin/destination to each: `route: { originIcao, destinationIcao, originLabel,
  destinationLabel } | null`.
- Best-effort: any routeset failure leaves `route: null` rather than failing the
  request. Enrichment happens before the ~8s cache write, so it's cached too.

**Front-end — `classify.ts`** (`src/lib/classify.ts`)
Resolves the owning airport from strongest to weakest evidence, and **labels rather
than guesses**:
1. **Route match** → origin/destination is EGLF/EGLL/EGKK ⇒ that airport,
   `basis: 'route'`, **not** indicative (the only confident outcome).
2. **Route elsewhere** → known route between other airports ⇒ `Transit` (confident
   it isn't ours).
3. **Proximity + altitude** → no route, but low (≤ 10,000 ft) and within 15 nm of an
   airport ⇒ that airport, `indicative: true`, with a heading-based "likely
   arrival/departure" note.
4. **Callsign prefix** → optional hint map (empty by default — prefixes identify the
   operator, not the airport; no guessing).
5. Otherwise ⇒ `Transit / overflight` (high) or `Transit / unknown`.

All thresholds live in `src/config/classification.ts`; geometry in `src/lib/geo.ts`
(`haversineNm`, `bearingDeg`, `angularDiff`).

**UI — `AirportTag`**
- Solid coloured pill for route-confirmed (Farnborough amber / Heathrow sky /
  Gatwick violet); **dashed outline with a `~` prefix and an "indicative" label**
  for geometric/callsign guesses; slate for transit/unknown.
- Shown on each `FlightCard`; `FlightDetail` adds a "Likely airport" block with the
  one-line reason, plus a Route row (origin → destination).

## Definition of Done

| DoD item | State |
|---|---|
| Flights show a sensible airport tag | ✅ route-confirmed and proximity tags render per flight |
| Unknowns are labelled, not guessed | ✅ transit/overflight/unknown labelled; geometric matches explicitly marked indicative |

## Verified

- `npm run build` + typecheck clean (front-end + Worker).
- **Headless browser test** with stubbed flights exercising every path: route→Heathrow
  (solid), no-route-near-Farnborough (indicative), route-between-other-airports
  (Transit), high-no-route (Transit / overflight). All four tags rendered correctly;
  no runtime errors. Screenshot captured.

## Honest limitations / for later

- **Live routeset coverage is unverified from the sandbox** (network-blocked) — the
  real adsb.lol response shape/coverage is first exercised on your phone. If route
  tags look wrong/missing on real data, send me an example and I'll adjust the
  parsing or thresholds.
- Business jets into Farnborough often have **no route data**, so they'll usually
  show as `~Farnborough · indicative` via proximity — expected, and the right
  honesty level.
- Proximity uses nearest-airport + altitude only; the corridor/altitude *rules*
  (Phase 4) will add more signal. Thresholds (`terminalRadiusNm` 15, `terminalMaxAltFt`
  10,000, `overflightAltFt` 18,000) are first guesses — easy to tune in config.
