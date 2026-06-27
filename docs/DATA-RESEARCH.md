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

## 2. Rwy 24 SID corridor — PARTIALLY confirmed ⚠️

**Confirmed:**
- The Rwy 24 departures are the **GWC 2F** and **HAZEL 2F** SIDs.
- They climb **south-west** toward Bentley and the A31, reaching **at/above
  4,000 ft over the A31 Hog's Back** — so `designAltitudeFt: 4000` is correct.
- There is a documented sensitivity area "1 NM NW of the nominal track of the
  GWC 2F and HAZEL 2F SIDs", consistent with our ~1.5 nm tolerance.

**Not obtainable by open research:** the **exact RNAV waypoint coordinates**. The
authoritative sources — the UK AIP / NATS eAIP (EGLF), the CAA airspace-change
PDFs, and chart providers (Navigraph/Jeppesen) — are access-gated and returned
HTTP 403 to automated fetches. I did **not** fabricate coordinates.

So `config/corridors.ts` keeps a **hand-drawn approximation** of the confirmed
routing (SW from the runway, crossing the A31 ridge), with the SID names and
altitude target corrected, and a clear comment that the lat/lon are not the
published centreline.

**To finish this (needs AIP/WebTrak access from a normal network):** see the
step-by-step handoff in [`CORRIDOR-DATA-EXTRACTION.md`](./CORRIDOR-DATA-EXTRACTION.md)
— extract the SID geometry from Farnborough WebTrak (`eu.webtrak.aero/fab`, layers
are GeoJSON) or the EGLF AIP chart, then drop the centrelines into
`config/corridors.ts`. The shape and altitude are the right ballpark today; only the
precise lateral track is approximate, and R3 is labelled indicative accordingly.

**Sources:**
- CAA Farnborough airspace change consultation (Part E) & post-implementation
  review (Annex A) — referenced for SID names and the ≥4,000 ft over A31 profile.
- NATS eAIP EGLF (AD 2) — authoritative SID charts (access-gated).
