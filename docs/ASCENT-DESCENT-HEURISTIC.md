# Ascent/descent trajectory heuristic for Farnborough

**Status: ✅ implemented (2026-06-29)** in `src/lib/trajectory.ts`, wired into
`classify.ts`, thresholds in `config/classification.ts` (`TRAJECTORY_THRESHOLDS`).
Built on the real WebTrak corridor swaths landed via
[`CORRIDOR-DATA-EXTRACTION.md`](./CORRIDOR-DATA-EXTRACTION.md).

## Deviation from the original plan (and why)

The plan allowed firing on **descent + heading alone** (no corridor) for the wider
funnel. Implementation made **corridor alignment mandatory** instead: Heathrow
(EGLL) is only ~12 nm from Farnborough, so a Heathrow arrival descending and
tracking roughly toward EGLF would false-fire on descent+heading. With the real
polygon swaths now available, point-in-polygon membership is the genuine
discriminator, and the WebTrak envelopes are generous ("most likely here"), so a
real Farnborough movement within the funnel is inside one. Net rule: **corridor +
one confirming signal** (descent/climb or heading) meets the threshold; corridor
alone (score 3) or motion-without-corridor (score 0) does not fire.

The rest of this document is the original plan, kept for context.

---

## Why

Business jets come back route-less from our crowd-sourced route DB (hexdb), so
FlightRadar identifies their destination (e.g. `SVW50MC` → Farnborough) and we
don't — FR24 has the **filed flight plan**, which isn't in ADS-B or in a
callsign→route database (see [`DATA-RESEARCH.md`](./DATA-RESEARCH.md)). Short of a
paid flight-plan API, the best free signal is the aircraft's **trajectory**: a jet
descending and tracking toward Farnborough along an arrival path is very likely
arriving there; one climbing away along a SID is very likely departing.

Today `classify.ts` only tags Farnborough by **proximity** (low + within 15 nm).
This plan upgrades that to use vertical rate, heading and corridor alignment so we
catch inbound/outbound biz jets earlier and more reliably — still **indicative**
(route-confirmed always wins).

## Why it depends on accurate corridors

Descent + heading alone over-claims: a Heathrow/Gatwick arrival descending *through*
the Farnborough area heading roughly toward it would be mis-tagged. The
discriminator is **alignment with a real Farnborough arrival/departure track** —
i.e. the published STAR/SID centrelines. With only the current seed departure
polyline (and no arrival corridors at all), that check isn't trustworthy. So the
prerequisite is: accurate EGLF **SID and STAR** geometry in `config/corridors.ts`,
including `kind: 'arrival'` corridors (the map overlay already supports them).

## Signals

Compute, per flight (skip if route already resolves to one of our airports):
- `dNm` = distance flight→EGLF; `toField` = bearing flight→EGLF; `fromField` =
  bearing EGLF→flight.
- vertical rate, baro altitude, selected altitude (`navAltitudeFt`), track.
- `categoryFitsAirport(category, 'EGLF')` must hold (size ceiling, already built).

**Arrival (descending in):**
- descending (`verticalRateFpm < ~ -300`)
- track points at the field (`angularDiff(track, toField) ≤ ~40°`)
- within a wider funnel than today (`dNm ≤ ~30`, `altBaro ≤ ~12,000 ft`)
- **aligned with an arrival corridor** (lateral offset ≤ corridor tolerance) ← needs STAR geometry
- bonus: `navAltitudeFt` low (≤ ~5,000 ft) — being vectored down

**Departure (climbing out):**
- climbing (`verticalRateFpm > ~ +500`)
- track points away from the field (`angularDiff(track, fromField) ≤ ~40°`)
- near the field and low (`dNm ≤ ~12`, `altBaro ≤ ~8,000 ft`)
- **aligned with a departure (SID) corridor** ← needs SID geometry

## Algorithm (scored, not hard gates)

Accumulate evidence and require a threshold, so no single weak signal decides it:

```
score = 0
if descending           score += 2
if headingTowardField    score += 2
if alignedWithArrivalCorridor  score += 3   // the key discriminator
if selectedAltLow        score += 1
=> "arriving Farnborough (indicative)" if score >= 5
```
Mirror for departures (climb / heading-away / SID alignment). Corridor alignment
is weighted highest because it's what separates a genuine Farnborough movement
from an overflight. Output a rich reason, e.g.
*"Descending through 6,000 ft, 18 nm out, tracking the RNAV arrival — likely
Farnborough arrival (indicative)."*

## Integration

- New `src/lib/trajectory.ts` (or extend `classify.ts`): `farnboroughTrajectory(flight)`
  → `{ phase: 'arrival' | 'departure' | null, reason }`.
- In `classify.ts`, run it in the proximity branch **before** the simple
  nearest-airport check; if it fires, classify EGLF with `basis: 'proximity'`,
  `indicative: true`, and the trajectory reason. Keep the existing simple proximity
  as the fallback for level/near traffic.
- Generalises later to EGLL/EGKK if we add their corridors.

## Config to add (`config/classification.ts`)

`TRAJECTORY_THRESHOLDS`: `descentRateFpm` (-300), `climbRateFpm` (+500),
`arrivalMaxDistanceNm` (30), `arrivalMaxAltFt` (12,000), `departureMaxDistanceNm`
(12), `departureMaxAltFt` (8,000), `headingToleranceDeg` (40), score weights and
`arrivalScoreThreshold` / `departureScoreThreshold`. Keep everything tunable here.

## False-positive controls

- Corridor alignment is mandatory-ish (highest weight) — without it, only strong
  descent+heading both true should ever fire, and even then label cautiously.
- Size ceiling (`categoryFitsAirport`) already excludes heavies.
- Don't fire for level flight or climbing-at-cruise.
- Always `indicative`; route-confirmed wins; the UI keeps the "indicative" marker.

## Verification

- Synthetic headless tests: descending-toward-EGLF aligned flight → arrival;
  climbing-away aligned → departure; a Heathrow-ish descent passing near but
  off-corridor → NOT Farnborough.
- Spot-check live against FR24 for a session of real biz-jet arrivals once the
  corridors are in.

## Prerequisites checklist

- [x] Accurate EGLF **departure (SID)** geometry in `config/corridors.ts` (WebTrak swaths).
- [x] EGLF **arrival (STAR)** corridors added (`kind: 'arrival'`).
- [x] `trajectory.ts` implemented, wired into `classify.ts`, thresholds added, verified
      with synthetic cases (aligned descent → arrival; aligned climb → departure;
      off-corridor descent near field → not Farnborough; heavy → not Farnborough;
      level-in-swath → not Farnborough).

## Possible follow-ups

- Spot-check live against FR24 for a session of real biz-jet arrivals.
- Generalise to EGLL/EGKK once their corridor swaths are added (the same
  `kind`-filtered point-in-polygon approach applies).
