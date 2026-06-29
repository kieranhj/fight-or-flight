# Reference data research (Phase 6 follow-up)

Research into the two data-accuracy items deferred from Phase 6. Done June 2026.

## 1. Farnborough operating hours — CONFIRMED ✅

The R1 placeholder is now verified. Permitted aircraft operating hours
(**Condition 8 of planning permission 20/00871/REVPP**):

| Day type | Hours |
|---|---|
| Weekdays (Mon–Fri) | **07:00–22:00** |
| Weekends & bank holidays | **08:00–20:00** |
| Christmas Day & Boxing Day | No flying (except emergency) |

Context (not modelled in rules): the permission caps movements at **50,000/yr** with
a non-weekday sub-cap; a later application (23/00794/REVPP) sought to raise these,
but the **non-weekday operating hours (08:00–20:00) are unchanged** in those
proposals.

Our `config/airports.ts` values already matched — this removed the "approximate /
verify" caveat and cited the source.

**Sources** (cross-checked, two independent):
- Rushmoor Borough Council (the planning authority) — Farnborough Airport operating
  hours & complaints page.
- Farnborough Airport FAQ (farnboroughairport2040.com).

## 2. Farnborough corridor geometry — SOURCED ✅ (2026-06-29)

**Confirmed (context):**
- The Rwy 24 departures are the **GWC 2F** and **HAZEL 2F** SIDs, climbing
  **south-west** toward Bentley and the A31, reaching **≥ 4,000 ft over the A31
  Hog's Back**.

**Resolved:** the real published geometry was extracted from **Farnborough WebTrak**
on a non-sandboxed machine. WebTrak loads all overlays at startup (no fetch on
layer toggle); the geometry comes from
`POST https://focus-apis.emsbk.com/productinfo` (`…&sitename=fab&action=get_layers`)
— 17 EPSG:4326 polygons: lateral SID/STAR swaths ("Corridors") plus altitude-banded
Departures/Arrivals probability zones. Captured to `docs/data/webtrak-fab-layers.*`.

`config/corridors.ts` now holds these **real polygon swaths** (no more hand-drawn
centrelines). R2/R3 use point-in-polygon: R2 flags a flight below the published
altitude band of the zone it is in; R3 flags a flight inside none of the swaths.
Still labelled **indicative** (the swaths are "most likely here" envelopes). Full
trail and wiring notes: [`CORRIDOR-DATA-EXTRACTION.md`](./CORRIDOR-DATA-EXTRACTION.md).

**Sources:**
- Farnborough WebTrak (EMS Brüel & Kjær / Envirosuite) — published corridor/route
  layer geometry. Used under WebTrak's terms (attribution; non-commercial).
- CAA Farnborough airspace change consultation (Part E) & post-implementation
  review (Annex A) — SID names and the ≥4,000 ft over A31 profile.
- NATS eAIP EGLF (AD 2) — authoritative SID charts (access-gated; not needed).
