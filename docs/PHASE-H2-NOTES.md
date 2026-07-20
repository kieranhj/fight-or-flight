# Phase H2 — Sessionizer + D1 flight summaries

Second phase of [`TELEMETRY-CAPTURE-PLAN.md`](./TELEMETRY-CAPTURE-PLAN.md): the
nightly cron now turns each day's raw capture into queryable D1 rows — flights,
rule flags evaluated at the logged times, and daily stats.

## What was built

- `worker/src/rollup.ts` — after the nightly day-compaction, `rollupDay()`:
  1. **Sessionizes** the day file: records grouped by hex; a gap >10 min splits
     sessions. Single streaming pass — per-hex aggregates only, no full tracks
     held in memory.
  2. **Classifies** each session:
     - **Ground truth** (basis `ground`): the recorder keeps ground aircraft
       near EGLF/EGLK, so a session on the ground there before/after being
       airborne is *definitively* a departure/arrival (both → `local`, e.g.
       circuits). Ground-only sessions (parked, pinging) are stored but flagged
       `ground_only` and excluded from stats.
     - **Geometry fallback** (basis `geometry`, indicative): community-feed
       coverage often misses the lowest segment, so a session that *appears* or
       *vanishes* low over a field (EGLF ≤4 nm & ≤2,500 ft; EGLK ≤3 nm &
       ≤2,000 ft; nearest field wins — they're ~3 nm apart) counts as the
       takeoff/landing the feed missed.
  3. **Rules at logged times** (thresholds/geometry imported from the app's own
     `src/config` + `src/lib/geo` — single source of truth):
     - **R1 hours** (breach): takeoff/landing time vs the owning airport's
       permitted window, UK-local (GMT/BST-aware) with the bank-holiday
       calendar and the 5-min grace.
     - **R2 altitude** (indicative): worst sample below a WebTrak altitude-band
       zone floor (−500 ft margin).
     - **R3 corridor** (indicative): lowest sample within 12 nm of Farnborough
       outside *every* published swath. R2/R3 evidence is collected per sample
       but only attached when the session classifies as EGLF.
  4. **Writes D1** (idempotent per day: delete + re-insert): `flights`,
     `flight_flags`, `daily_stats`. Schema is `CREATE TABLE IF NOT EXISTS` on
     use — no migration tooling at this scale.
- **Endpoints**:
  - `GET /api/history/rollup?day=YYYY-MM-DD` — manual/backfill (idempotent).
  - `GET /api/history/flights?day=…[&airport=EGLF][&flagged=1]` — flights + flags.
  - `GET /api/history/stats?from=…&to=…` — daily_stats rows.
- **Deploy plumbing**: the D1 `database_id` is account-specific, so
  `deploy-worker.yml` substitutes the `__FOAF_HISTORY_D1_ID__` placeholder in
  `wrangler.toml` at deploy time — from the repo Actions variable
  `FOAF_HISTORY_D1_ID` if set, else by Cloudflare-API lookup by name.

## One-time setup

1. `npx wrangler d1 create foaf-history` (or dashboard → D1) — **done**.
2. Either set the repo Actions **variable** `FOAF_HISTORY_D1_ID` to the
   database's UUID (dashboard → D1 → foaf-history), **or** make sure the
   `CLOUDFLARE_API_TOKEN` secret has D1 read access so the workflow can look it
   up by name. Merging without either fails the deploy with a clear error.

## Known limitations (accepted)

- Sessions crossing UTC midnight split into two flights (one per day file).
  EGLF is closed 22:00–07:00 local, so this barely affects permit stats.
- A session hopping EGLK→EGLF inside one gap-free track counts as `local` at
  the departure field. Rare; refine if it shows up.
- A geometry-basis movement can't distinguish a missed-coverage landing from a
  very low go-around; basis is stored so the UI can label indicative movements.
- No route enrichment in the rollup (zero external calls by design); origin/
  destination can be added later from the live app's cached lookups if wanted.

## Verification performed (local, offline)

A generator script built a synthetic UTC day (2026-07-15, a Wednesday) using
the **real corridor polygons** — every scenario's geometry asserted (a grid
probe of the swaths located genuine on/off-corridor coordinates) — then the
full path ran under `wrangler dev` with local R2 + D1:

| Scenario | Expected → got |
|---|---|
| Ground roll + climb-out in the 24-dep corridor, 11:00 BST | EGLF `dep`/`ground`, takeoff 10:01Z, no flags ✓ |
| Descent + touchdown at 22:30 BST (weekday) | EGLF `arr`/`ground`, **R1 breach** "landing at 22:30 UK … outside 07:00–22:00" ✓ |
| Low descent through the off-swath gap N of the field, vanishing 2 nm out | EGLF `arr`/`geometry` + **R3** "2.1 nm … 1,750 ft … outside every published corridor swath" ✓ |
| EGLK circuit (ground → 1,200 ft → ground) | EGLK `local`/`ground`; its off-EGLF-swath samples correctly attach **no** R3 (not an EGLF flight) ✓ |
| FL350 transit | no airport, no flags ✓ |
| Parked at EGLF (ground pings only) | `ground_only`, excluded from stats ✓ |

Daily stats came out exactly: 5 flights (parked excluded), EGLF 1 dep + 2 arr
(2 ground-basis, 1 geometry), EGLK 1+1, 1 breach, 1 indicative. Re-running the
rollup produced identical results (idempotent); the `flagged=1` filter and the
stats range endpoint returned the right rows. `npm run build` typecheck clean.
