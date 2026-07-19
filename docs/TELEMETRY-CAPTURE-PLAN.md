# Telemetry Capture & History — Build Plan

Continuous capture of all aircraft telemetry within **25 nm of home**, stored
cheaply in the cloud (no machine at home), powering post-hoc analysis: Farnborough
movement statistics vs permit limits, day-by-day replay ("scrubbing"), automatic
tagging of potentially-offending flights for later complaints, and repeat-offender
tracking by callsign/registration.

**Decisions (agreed 2026-07):** radius **25 nm**, budget **$5/mo (Cloudflare
Workers Paid)**, cadence **15 s**, UI lives in the **same PWA** (a History tab).

---

## 1. Why record at all

None of the free feeds we use offer history: airplanes.live and adsb.lol are
real-time snapshots only; OpenSky's historical database needs an approved research
application and has poor low-altitude coverage here; ADS-B Exchange sells history
commercially. **History starts the day our recorder switches on** — hence the
capture phase ships first, analysis follows while data accumulates.

A bonus of continuous capture: Farnborough movements become **definitively
identifiable** — an aircraft seen on the ground at EGLF before departure or after
arrival needs no heuristic. The classify/trajectory guesswork remains only for
flights first seen airborne.

## 2. What 25 nm of home includes

- **Airfields:** Farnborough (~5 nm), Blackbushe (~8 nm), RAF Odiham (~6 nm),
  Lasham (~9 nm, mostly transponder-less gliders), Fairoaks (~13 nm), Dunsfold
  (~11 nm), **Heathrow (~21.5 nm)** and **Gatwick (~23 nm)** — both *inside*.
- **Airspace:** 100% of the Farnborough WebTrak swaths, the Ockham (OCK) Heathrow
  hold, LHR south-westerly departures and easterly-ops arrival flows, LGW westerly
  climb-outs, and all local GA.
- **Consequence:** LHR/LGW *ground* traffic would dominate the data for zero
  analytical value → the recorder keeps ground aircraft only within 3 nm of
  EGLF/EGLK and drops ground traffic elsewhere.

**Known coverage caveats** (accept and note, don't solve): community feeds miss
some very-low-altitude moments and MLAT-only/military aircraft intermittently;
Lasham gliders are largely invisible. Fine for statistics and evidence; quote
numbers against permits as "at least N".

## 3. Architecture

```
┌────────────── Cloudflare (existing account, Workers Paid $5/mo) ──────────────┐
│                                                                               │
│  Worker (existing, + scheduled handlers)                                      │
│  ├── cron "* * * * *"  → capture: poll upstream 4× (every 15 s), trim,        │
│  │                        filter, write 1 gzipped NDJSON object → R2          │
│  ├── cron hourly       → compact previous hour's ≤60 minute-objects into an   │
│  │                        hour file (two-stage: R2 binding calls count toward │
│  │                        the 1,000-subrequest/invocation limit, so one pass  │
│  │                        over 1,440 minute objects would bust it)            │
│  ├── cron nightly      → merge previous day's 24 hour-files into a day file;  │
│  │                        (H2) sessionize into flights; write D1 rows; run    │
│  │                        rules per flight; write flags + daily stats         │
│  └── fetch /api/history/* → serve stats, flight lists, day replay files       │
│                                                                               │
│  R2 bucket `foaf-telemetry`   raw/YYYY/MM/DD.ndjson.gz                        │
│                               (+ minute/ and hour/ staging, state/ summaries) │
│  D1 database `foaf-history`   flights / flight_flags / daily_stats           │
└───────────────────────────────────────────────────────────────────────────────┘
          ▲                                            ▲
   airplanes.live (primary)                    PWA History tab
   adsb.lol (fallback)                         (stats · scrubber · offender log)
```

Same Worker as the live proxy (one deploy, one config); capture is a separate
module reached via the `scheduled` handler, so a capture bug can't break the live
`/api/nearby` path beyond that invocation.

### Capture invocation (every minute)

1. At t≈0/15/30/45 s: fetch upstream point query (lat/lon/25 nm), primary →
   fallback, same normalization as `/api/nearby`.
2. Trim each aircraft to the **capture record** (short keys, rounded values):
   `t` (epoch s), `i` (hex), `c` (callsign), `q` (squawk), `la`/`lo` (5 dp),
   `ab`/`ag` (baro/geom alt ft), `gs`, `tr` (track), `vr` (fpm), `na` (nav alt),
   `ct` (category), `ty` (type), `g` (on-ground 0/1), `m` (military 0/1).
   ~120–150 B/record raw.
3. Filter: drop `g=1` aircraft further than 3 nm from EGLF/EGLK.
4. Gzip the minute's samples → `PUT minute/YYYY/MM/DD/HHMM.ndjson.gz`.
5. Failures: skip the sample (gap), never retry-storm; upstream 429 → back off
   the rest of the minute.

**Feed courtesy:** 4 requests/min against a public limit of 1 req/s — well
inside; single location; identifiable User-Agent.

### Compaction & nightly rollup

1. **Compact (two-stage):** hourly cron merges the previous hour's minute
   objects into `hour/…/HH.ndjson.gz`; nightly cron (~00:15 UTC) merges the 24
   hour files into `raw/YYYY/MM/DD.ndjson.gz` (~3–4 MB) and deletes the staging
   objects. Both idempotent. (Paid tier's 30 s CPU makes the gzip work safe.)
2. **Sessionize:** group records by hex; a >10 min gap splits sessions. Per
   flight: first/last seen, min/max alt, sample count, ground-at-EGLF/EGLK
   start/end → **definitive** departure/arrival + timestamps; else run the
   existing classify/trajectory heuristics on the track.
3. **Rules:** run R1 hours / R2 altitude / R3 corridor (existing `rulesEngine`)
   over each Farnborough-associated flight *at its logged times*; persist flags.
4. **Stats:** upsert `daily_stats` (movements by airport, departures/arrivals,
   night/early movements, weekend flag, breach counts).

Code sharing: the classify/rules/geo/corridor modules in `src/lib` + `src/config`
are DOM-free TypeScript — the Worker imports them directly (tsconfig.worker
already builds from the repo root).

### D1 schema (summary layer — the raw NDJSON in R2 stays the source of truth)

```sql
flights(id, day, hex, callsign, reg, type, category, military,
        first_ts, last_ts, samples, min_alt_ft, max_alt_ft,
        airport,            -- EGLF/EGLK/EGLL/EGKK/null
        movement,           -- 'dep' | 'arr' | null
        basis,              -- 'ground' (definitive) | 'route' | 'trajectory' | 'proximity'
        min_dist_home_nm)
flight_flags(flight_id, rule_id, severity, reason, ts, lat, lon, alt_ft)
daily_stats(day PRIMARY KEY, eglf_dep, eglf_arr, eglf_night, eglf_weekend,
            breach_count, indicative_count, first_gap_min, coverage_pct)
```

Volumes: ~200–600 flights/day → <100 k rows/yr; trivially inside D1 limits.

### History API (Worker fetch routes)

- `GET /api/history/stats?from&to&bucket=day|week|month|year`
- `GET /api/history/flights?day|hex|callsign|flagged&…` (paged)
- `GET /api/history/day/YYYY-MM-DD` → the day's gzipped NDJSON (replay file)
- `GET /api/history/offenders?window=90d` → flights+flags grouped by hex/callsign
- `GET /api/history/health` → last capture ts, yesterday's coverage %, R2/D1 sizes

Read-only, cached at the edge. Data is derived from public feeds, so open read
access is acceptable; a simple bearer token can be added later if wanted.

## 4. Budget

| Item | Usage | Cost |
|---|---|---|
| Workers Paid plan | cron 44 k invocations/mo, CPU well under included 30 M ms | **$5/mo flat** |
| R2 storage | ~1.5 GB/yr compressed | $0 (free 10 GB ≈ 6+ yrs) |
| R2 operations | ~45 k writes/mo, reads cached | $0 (free 1 M/10 M) |
| D1 | <100 k rows/yr, rollup writes nightly | $0 (included) |
| **Total** | | **$5/mo** |

## 5. Farnborough permit numbers (for the stats screens)

To check against: annual movement cap and the weekend/bank-holiday sub-cap from
the 2019 planning permission, plus the confirmed operating hours (Condition 8 of
20/00871/REVPP: weekdays 07:00–22:00, weekends/BH 08:00–20:00) already in
`config/rules.ts`. **TODO before Phase H3:** verify the current caps (believed
50,000 movements/yr with ≤8,900 at weekends/BH) against the decision notice and
put them in `config/permits.ts` — never hard-code unverified numbers into a
user-facing "% of permit used" display.

## 6. Phases (one PR each, deploy after each)

- **H1 — Recorder** *(ship ASAP; every day not recording is data lost forever)*
  Capture module + minute cron + R2 writes + compaction cron + `/api/history/health`.
  One-time user steps: enable Workers Paid, `wrangler r2 bucket create foaf-telemetry`,
  redeploy. DoD: health shows continuous capture over 24 h; day file appears; spot-check
  a known flight against FR24.
- **H2 — Sessionizer + D1**
  Nightly rollup: flights, ground-truth EGLF movements, rules flags, daily_stats.
  One-time: `wrangler d1 create foaf-history` + migration. DoD: yesterday's flights
  queryable; a known EGLF departure shows `basis='ground'`, correct times.
- **H3 — History tab v1: stats + flight log**
  Stats dashboard (day/week/month/year vs permits), browsable flight list with
  filters (flagged / EGLF-only / night / weekend), flight detail reusing the
  Review components. DoD: pick any recorded day, see movements + flags.
- **H4 — Day replay (scrubber)**
  Day picker → fetch replay file → timeline slider animating aircraft on the map
  (existing markers/corridor overlays), tap-to-inspect at any moment. DoD: scrub a
  full day smoothly on a phone (file ~3–4 MB, indexed client-side).
- **H5 — Offenders & post-hoc complaints**
  Auto-tagged offender log with review workflow (mirrors the incident-log review),
  repeat-offender table by callsign/hex (count, rules hit, trend), one-tap prefilled
  post-hoc complaint (never auto-sent), CSV export. DoD: repeat low/off-corridor
  callsigns surface with evidence links to replay.

## 7. Risks & mitigations

- **Cron gaps** (platform hiccups): coverage % in daily_stats; gaps visible, never
  silently interpolated.
- **Upstream shape drift:** capture stores our normalized record, so history stays
  uniform even if providers change.
- **Data loss:** R2 is durable; D1 is rebuildable from R2 at any time (rollup is
  idempotent per day).
- **Double-billing surprise:** everything metered sits far inside included
  quantities; the only bill is the flat $5.
- **Legal/ToS:** same feeds, same non-commercial attribution as the live app;
  recording our own derived records is within their terms.
