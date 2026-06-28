# TODO: Replace seed corridor geometry with real Farnborough Rwy 24 SID tracks

**Status:** open. The one remaining data-accuracy item from Phase 6. Everything
else (incl. the Farnborough operating hours) is confirmed — see
[`DATA-RESEARCH.md`](./DATA-RESEARCH.md).

This document is a self-contained handoff for **a human (extract the data) and a
future agent (wire it in)**.

---

## What's needed and why

The R2 (altitude-floor) and R3 (corridor-proximity) rules compare each Farnborough
flight against a **departure corridor centreline**. Today that centreline in
`src/config/corridors.ts` is a **hand-drawn approximation** — the shape and the
≥4,000 ft-over-the-A31 altitude target are right, but the exact lateral track is
not the published one. We want to replace it with the **real RNAV SID geometry**.

Confirmed facts (don't re-research these):
- Rwy 24 SIDs are **GWC 2F** and **HAZEL 2F**.
- They climb **south-west** over Bentley / the **A31 Hog's Back**, reaching
  **≥ 4,000 ft** over the A31. So `designAltitudeFt: 4000` is correct.
- A documented sensitivity area sits **~1 NM NW of the nominal track** → our
  `toleranceNm` of ~1.5 is in the right ballpark.

## Why it's still open

The authoritative sources are **access-gated and blocked from the build sandbox**
(the remote agent environment's network policy returns HTTP 403 for them, the same
wall that blocks the ADS-B feeds):
- UK AIP / NATS eAIP (EGLF AD 2 — SID charts)
- CAA airspace-change PDFs (ACP Part E, PIR Annex A)
- Chart providers (Navigraph / Jeppesen)
- **Farnborough WebTrak** — `https://eu.webtrak.aero/fab` (blocked from sandbox,
  but reachable from a normal browser)

WebTrak is the best lead: its **map layers are the published corridor/route
geometry**, usually served as GeoJSON.

---

## Step 1 (human, on a normal network): get the geometry out of WebTrak

**Option A — capture the layer data (preferred; gives exact coordinates):**
1. Open `https://eu.webtrak.aero/fab` in Chrome/Edge.
2. DevTools (F12) → **Network** tab → filter **Fetch/XHR**.
3. Toggle on the **corridors / routes layer** (the SID swathes).
4. Find the request whose response is JSON/GeoJSON full of coordinate pairs
   (name likely contains `layer`, `route`, `corridor`, `gate`, `.json`/`.geojson`).
5. Right-click → **Copy response** (or Save). Save it into this repo as
   `docs/data/webtrak-fab-layers.geojson` (create the folder), **and/or** note the
   request **URL** — if it's a stable public URL, a future agent can fetch it
   directly from a non-sandboxed machine.

**Option B — rough fallback:** in WebTrak, click ~5–8 points along the Rwy 24
corridor centreline and read off the lat/lon; drop them in
`docs/data/webtrak-fab-points.txt`, one `lat, lon` per line, runway end first.

Commit whatever you capture so the next agent has it.

## Step 2 (agent): wire it into the config

Target file: `src/config/corridors.ts`. The shape (see `Corridor` type there):

```ts
type Corridor = {
  id: string
  airport: 'EGLF' | 'EGLL' | 'EGKK'
  label: string
  centreline: { lat: number; lon: number }[] // ordered, runway end → outbound
  toleranceNm: number
  designAltitudeFt?: number
  note?: string
}
```

Instructions:
1. If GeoJSON: each SID centreline is a `LineString` (or the spine of a polygon
   swath). Convert each to an ordered `centreline` array (runway end first). Prefer
   the **centreline**; if only a swath polygon exists, take its centre spine and set
   `toleranceNm` to roughly half the swath width.
2. Add **one `Corridor` entry per SID** (GWC 2F, HAZEL 2F) rather than merging them —
   R3 already takes the *nearest* centreline across all of an airport's corridors.
3. Keep `airport: 'EGLF'`, `designAltitudeFt: 4000`, and an honest `note`. The
   geometry is real but the rule output is still **indicative** — keep that wording.
4. Coordinates are decimal degrees, **lon negative** for west.

## Step 3 (agent): verify

- `npm run build` (tsc + vite) must pass.
- The rules that consume this (no code change needed, but know them):
  - **R2** (`rulesEngine.ts` → `r2Altitude`): uses the first EGLF corridor's
    `designAltitudeFt`, within `RULE_THRESHOLDS.altitudeCheckMaxDistanceNm` (8 nm).
  - **R3** (`r3Corridor`): `distanceToPolylineNm(pos, centreline)`; flags when
    `tol < offset ≤ RULE_THRESHOLDS.corridorMaxOffsetNm` (5 nm) within 8 nm of EGLF.
  - All thresholds live in `src/config/rules.ts`.
- Sanity check: a point known to be on the centreline should give R3 offset ≈ 0; a
  point ~2 nm to the side should trigger "Off track". The user's home
  (51.188, −0.802, Lower Bourne) sits just south of the Hog's Back — a useful
  reference for whether the corridor passes where expected.
- Optional: a tiny throwaway Node script using `distanceToPolylineNm` to print the
  offset of a few sample points before/after, to confirm the new geometry behaves.

## Downstream work this unblocks

Once the corridors (SIDs **and** STARs) are accurate, the deferred
**ascent/descent trajectory heuristic** can be built — it uses corridor alignment
to identify Farnborough arrivals/departures (the biz-jet traffic FR24 gets from
flight plans and we currently miss). See
[`ASCENT-DESCENT-HEURISTIC.md`](./ASCENT-DESCENT-HEURISTIC.md). That plan needs
`kind: 'arrival'` corridors too, so extract STARs from WebTrak, not just the Rwy 24
departures.

## Step 4: tidy up

- Update `docs/DATA-RESEARCH.md` (item 2) and `README.md` to mark the corridor
  geometry as sourced.
- Mention the WebTrak source + capture date in the `corridors.ts` comment and
  respect WebTrak's terms (attribution; non-commercial).
