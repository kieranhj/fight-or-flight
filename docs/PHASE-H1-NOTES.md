# Phase H1 — Telemetry recorder

First phase of [`TELEMETRY-CAPTURE-PLAN.md`](./TELEMETRY-CAPTURE-PLAN.md):
continuous capture of all aircraft within **25 nm of home** to R2, so analysis
(H2+) has data to work on. **Every day the recorder isn't deployed is data lost
forever** — the free feeds keep no history.

## What was built

- `worker/src/capture.ts` — the recorder:
  - **Capture cron (`* * * * *`)**: each minute, polls the feeds 4× at 15 s
    intervals (primary airplanes.live → fallback adsb.lol, one attempt each, a
    429 stands the recorder down for the rest of the minute), trims each
    aircraft to a ~120–150 B short-key record, and writes one gzipped NDJSON
    object `minute/YYYY/MM/DD/HHMM.ndjson.gz`. A failed minute = a missing key
    (a visible gap), never a retry-storm.
  - **Ground filter**: on-ground aircraft are kept only within 3 nm of
    EGLF/EGLK (that's how Farnborough movements get tracked gate-to-gate);
    taxiing traffic elsewhere — Heathrow and Gatwick are both inside 25 nm — is
    dropped. Positionless records are dropped.
  - **Two-stage compaction**: hourly cron (`5 * * * *`) merges the previous
    hour's ≤60 minute-objects into `hour/…/HH.ndjson.gz`; daily cron
    (`15 0 * * *`) merges the previous UTC day's 24 hour-files into
    `raw/YYYY/MM/DD.ndjson.gz` and writes a `state/day-….json` summary. Two
    stages because R2 binding calls count against the 1,000-subrequest limit per
    invocation — a single pass over 1,440 minute objects would bust it.
    Both stages are idempotent (safe to re-run; sources deleted only after the
    merged file exists).
- `worker/src/shared.ts` — upstream feed access extracted from `index.ts`, now
  shared by the proxy and the recorder. Supports `UPSTREAM_BASE` (env var) to
  point at a stub server for offline testing.
- New endpoints:
  - `GET /api/history/health` — `{recording, lastCapture, yesterday, config}`.
  - `GET /api/history/compact?hour=YYYY-MM-DDTHH | day=YYYY-MM-DD` — run a
    compaction stage by hand (ops/backfill; idempotent).
- `wrangler.toml` — the three cron triggers + the `TELEMETRY` R2 binding.

All keys/day boundaries are **UTC**; the analysis layer (H2+) converts to
Europe/London where rules need local time (permit hours are local).

## One-time setup (before merging / deploying)

The deploy Action redeploys the Worker on merge, and **fails if the bucket
doesn't exist yet**, so do these first:

1. **Workers Paid plan** ($5/mo): dashboard → Workers & Pages → Plans →
   Workers Paid. (Compaction needs more than the free plan's 10 ms CPU.)
2. **Create the R2 bucket** (first R2 use asks to enable R2 — the free 10 GB
   tier is what we stay inside): dashboard → R2 → Create bucket →
   name **`foaf-telemetry`** — or `npx wrangler r2 bucket create foaf-telemetry`.
3. Merge the PR (or run the *Deploy Worker* workflow manually). Cron triggers
   activate on deploy.

## Verify it's recording

```bash
curl https://aircraft-complaint-proxy.kieranhj.workers.dev/api/history/health
```

- Within ~2 minutes of deploy: `recording: true`, `lastCapture` shows the
  minute key, sample count (4), record count and source.
- Next day: `yesterday` shows `{day, hours: 24, records, bytes}` once the
  00:15 UTC merge has run; `raw/YYYY/MM/DD.ndjson.gz` appears in the bucket.
- Spot-check: pick a known flight (e.g. on FR24) and confirm its hex appears in
  the day file.

## Costs & responsible use

~44k cron invocations/month, ~4 upstream requests/min from one location with an
identifying User-Agent — within airplanes.live's ~1 req/s guidance; a 429 backs
off for the rest of the minute. R2: ~45k writes/month (free tier 1M), ~3–4 MB/day
stored (free tier 10 GB ≈ 6+ years). Everything inside the $5/mo Workers Paid
plan with no metered overage at this scale.

## Verification performed (local, offline)

End-to-end against a stub feed (`UPSTREAM_BASE`) under `wrangler dev
--test-scheduled` with a local R2 simulation: capture cron fired → 4 samples
polled at 15 s spacing → minute object written (airborne + EGLF-ground aircraft
kept; Heathrow-ground and positionless dropped) → hour compaction merged and
deleted minute objects → day compaction produced `raw/…` + summary →
`/api/history/health` reported `recording: true` with correct counts. Plus
`npm run build` typecheck.
