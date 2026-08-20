# Worker — Fight or Flight data proxy

A thin Cloudflare Worker that the front-end talks to instead of calling ADS-B
feeds directly. It solves CORS, smooths upstream rate limits via short caching,
and keeps room for server-side route enrichment and future API keys.

## Endpoints

| Method | Path | Behaviour |
|---|---|---|
| `GET` | `/api/nearby?lat&lon&radius&n` | Nearest aircraft: normalize → filter → sort → trim → route-enrich. CORS. |
| `GET` | `/api/route-lookup?callsign=BAW117` | Cached route lookup used by the app and the nightly rollup. |
| `GET` | `/api/route?callsign=BAW117` | Diagnostic: probes every route provider fresh and reports each. |
| `GET` | `/api/history/health` | Recorder status: `pausedSince`, last capture, per-feed health/backoff, yesterday's summary. |
| `GET` | `/api/history/compact?hour=…\|day=…` | Run a compaction stage by hand (idempotent; ops/backfill). |
| `GET` | `/api/history/rollup?day=…` | Sessionize a day's capture into D1 (idempotent; runs nightly). |
| `GET` | `/api/history/flights?day=…` | A day's flights + rule flags (`&airport=EGLF`, `&flagged=1`). |
| `GET` | `/api/history/stats?from=…&to=…` | Daily movement/breach stats rows. |
| `GET` | `/api/history/day/YYYY-MM-DD` | Full NDJSON track file for replay (today merges live from staging). |
| `GET` | `/api/history/offenders?days=…` | Flagged flights + repeat-offender aggregates by airframe. |
| `GET` | `/health` | Liveness JSON. |
| `OPTIONS` | `*` | CORS preflight (204). |

## Telemetry recorder — PAUSED since 2026-08-20

**Capture is stopped; the archive is kept.** The crons are commented out in
`wrangler.toml` and `RECORDING_PAUSED` is set, so `captureMinute()` refuses to run
and `/api/history/health` reports `pausedSince`. Every read endpoint still serves
the 19 Jul – 20 Aug 2026 archive, and `/api/nearby` — the app's actual job — is
untouched. The reason is coverage: the caps this was built to test average ~137
movements/day and our best fortnight measured ~100, so the count could never
demonstrate a breach. See [`docs/RECORDING-PAUSE.md`](../docs/RECORDING-PAUSE.md)
for the full reasoning, how to export the archive, and how to restart.

The rest of this section describes the recorder as it runs when enabled.

`src/capture.ts` + the cron triggers in `wrangler.toml` continuously record all
aircraft within 25 nm of Farnborough Airport to the `foaf-telemetry` R2 bucket (15 s cadence,
gzipped NDJSON, minute→hour→day compaction). Requires the Workers Paid plan and
the bucket to exist before deploying — see
[`docs/PHASE-H1-NOTES.md`](../docs/PHASE-H1-NOTES.md) for setup, layout and
verification, and [`docs/TELEMETRY-CAPTURE-PLAN.md`](../docs/TELEMETRY-CAPTURE-PLAN.md)
for the full architecture. Set `UPSTREAM_BASE` (e.g. via `--var` in dev) to point
feed access at a stub server for offline testing; a comma-separated list stands in
for the whole primary→fallback chain.

A feed that refuses us is **backed off rather than retried**: 15 min after a
403/401, 5 min after a 429, 1 min after a transient error, doubling per
consecutive failure up to 6 h. Without this a blocked feed was asked 4x/minute
indefinitely — ~5,760 pointless requests a day. Per-feed health (status,
consecutive failures, stand-down expiry, and the feed's own error message) is
kept in `state/feeds.json` and surfaced by `GET /api/history/health`, so a thin
day shows its cause. `state/last.json` also records `attempted` and `expected`
alongside `samples`, so partial minutes are visible rather than silent.

Routes are looked up per-callsign from an ordered chain of route databases
(`ROUTE_PROVIDERS`, currently **adsbdb → hexdb**) and cached at the edge — positive
hits for ~6 h, "unknown callsign" for ~30 min — with a **per-provider** 5-minute
backoff on a 429 or 403. Pinning a single provider was the bug: adsbdb once
rate-limited our shared egress (so hexdb was pinned), then hexdb began serving a
Cloudflare bot challenge to Workers egress, which silently killed every lookup.
Airport display names are taken from the route response itself where the provider
supplies them, so a blocked name service cannot downgrade "Shannon (SNN)" to
"EINN". Raw ADS-B has no origin/destination, so this lookup is what populates the
route (like FR24); business jets often have no published schedule and will show
none — coverage around Farnborough is only a few percent of movements.
`GET /api/route` probes every candidate provider so a working one can be chosen.

Phase 1 replaces the `/api/nearby` stub body with a real call to
`api.adsb.lol/v2/point/{lat}/{lon}/{radius}`: normalize fields, sort by distance,
apply exclusion filters and cache ~8s.

## Develop

```bash
npm install
npm run worker:dev      # http://127.0.0.1:8787
curl "http://127.0.0.1:8787/api/nearby?lat=51.2758&lon=-0.7763&radius=10&n=8"
```

## Deploy

```bash
npx wrangler login
npm run worker:deploy
```

After deploy, set the front-end's `VITE_WORKER_BASE` to the printed
`*.workers.dev` URL (or your custom domain) so the built site points at it.
Optionally lock CORS to your Pages origin via `ALLOWED_ORIGIN` in `wrangler.toml`.

## Responsible use of the community feeds

The data comes from a free, volunteer-run, **non-commercial** feed
([adsb.lol](https://adsb.lol), open data under ODbL).
The Worker is the single choke-point in front of them, and is deliberately built
to be a good citizen:

- **The app is tap-only.** The front-end fetches when you press the button; there is
  no background timer by default (Settings has an opt-in auto-refresh, min 10 s).
- **The recorder polls at a fixed, modest rate.** One point query every 15 s
  (4/minute) for a single fixed location and radius — no crawling, no per-aircraft
  fan-out, no second region. This is the continuous half of the project and is
  stated plainly rather than buried: see "Telemetry recorder" above.
- **Only against a feed whose terms permit it.** adsb.lol is open data (ODbL) with
  an open API. airplanes.live was removed on 2026-08-20 because their terms §4
  forbid systematic retrieval into a database, and automated data-gathering tools,
  without written permission — see the top-level README. Their free API was
  withdrawn from everyone that same week, so the `403` from 2026-08-13 was the
  leading edge of a general shutdown rather than a block aimed at this project.
- **A refusing feed is backed off, not retried.** 15 min after a 403/401, 5 min
  after a 429, doubling to a 6 h cap, with the reason recorded in
  `/api/history/health`.
- **~8s edge cache.** Repeated taps from the same area reuse a cached result
  (Cache API key + `cf.cacheTtl`), so identical queries don't re-hit upstream.
- **One attempt, no aggressive retry.** Each request makes a single call; we never
  immediately re-hit a feed that just errored — especially not a `429`.
- **Stale-on-error, not retry-storms.** When the feed blips, we serve the last
  good result (≤ 5 min) instead of generating more load.
- **Identifiable + attributed.** Every upstream request sends a descriptive
  `User-Agent` with this repo's URL, and the UI credits both feeds.

Route lookups (adsbdb.com) are **per-callsign and edge-cached** (positive ~6 h,
negative ~30 min), so repeated traffic doesn't re-hit the route database.

If usage ever grows beyond personal scale, the next responsible steps would be:
honouring `Retry-After`, longer/shared route caching, and feeding data back to the
community projects (adsb.lol grants keys "by feeding").
