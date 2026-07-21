# Worker — Fight or Flight data proxy

A thin Cloudflare Worker that the front-end talks to instead of calling ADS-B
feeds directly. It solves CORS, smooths upstream rate limits via short caching,
and keeps room for server-side route enrichment and future API keys.

## Endpoints

| Method | Path | Behaviour |
|---|---|---|
| `GET` | `/api/nearby?lat&lon&radius&n` | Nearest aircraft: normalize → filter → sort → trim → route-enrich. CORS. |
| `GET` | `/api/route?callsign=BAW117` | Diagnostic: the origin/destination we resolve for a callsign. |
| `GET` | `/api/history/health` | Telemetry recorder status: last capture + yesterday's summary. |
| `GET` | `/api/history/compact?hour=…\|day=…` | Run a compaction stage by hand (idempotent; ops/backfill). |
| `GET` | `/api/history/rollup?day=…` | Sessionize a day's capture into D1 (idempotent; runs nightly). |
| `GET` | `/api/history/flights?day=…` | A day's flights + rule flags (`&airport=EGLF`, `&flagged=1`). |
| `GET` | `/api/history/stats?from=…&to=…` | Daily movement/breach stats rows. |
| `GET` | `/api/history/day/YYYY-MM-DD` | Full NDJSON track file for replay (today merges live from staging). |
| `GET` | `/api/history/offenders?days=…` | Flagged flights + repeat-offender aggregates by airframe. |
| `GET` | `/health` | Liveness JSON. |
| `OPTIONS` | `*` | CORS preflight (204). |

## Telemetry recorder

`src/capture.ts` + the cron triggers in `wrangler.toml` continuously record all
aircraft within 25 nm of home to the `foaf-telemetry` R2 bucket (15 s cadence,
gzipped NDJSON, minute→hour→day compaction). Requires the Workers Paid plan and
the bucket to exist before deploying — see
[`docs/PHASE-H1-NOTES.md`](../docs/PHASE-H1-NOTES.md) for setup, layout and
verification, and [`docs/TELEMETRY-CAPTURE-PLAN.md`](../docs/TELEMETRY-CAPTURE-PLAN.md)
for the full architecture. Set `UPSTREAM_BASE` (e.g. via `--var` in dev) to point
feed access at a stub server for offline testing.

Routes are looked up per-callsign from a route database (`ROUTE_PROVIDER`, default
**hexdb.io**) and cached at the edge — positive hits for ~6 h, "unknown callsign"
for ~30 min — with a 5-minute global backoff if the provider 429s us. Raw ADS-B has
no origin/destination, so this lookup is what populates the route (like FR24).
Business jets often have no schedule and will show no route. `GET /api/route` probes
all candidate providers (adsbdb, adsb.lol, hexdb) so a working one can be selected —
adsbdb rate-limits Cloudflare's shared egress IPs, which is why hexdb is the default.

Phase 1 replaces the `/api/nearby` stub body with a real call to
`api.airplanes.live/v2/point/{lat}/{lon}/{radius}`: normalize fields, sort by
distance, apply exclusion filters, cache ~8s, and fall back to `adsb.lol` on error.

## Develop

```bash
npm install
npm run worker:dev      # http://127.0.0.1:8787
curl "http://127.0.0.1:8787/api/nearby?lat=51.188&lon=-0.802&radius=10&n=8"
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

The data comes from free, volunteer-run, **non-commercial** feeds
([airplanes.live](https://airplanes.live) ~1 req/s; [adsb.lol](https://adsb.lol)).
The Worker is the single choke-point in front of them, and is deliberately built
to be a good citizen:

- **Tap-only, no polling.** The app fetches only when you press the button — there
  is no background timer or auto-refresh hammering the feeds.
- **~8s edge cache.** Repeated taps from the same area reuse a cached result
  (Cache API key + `cf.cacheTtl`), so identical queries don't re-hit upstream.
- **One attempt per feed, no aggressive retry.** Each request makes a single
  primary call (airplanes.live), falling back to adsb.lol only if it fails. We
  never immediately re-hit a feed that just errored — especially not a `429`.
- **Stale-on-error, not retry-storms.** When both feeds blip, we serve the last
  good result (≤ 5 min) instead of generating more load.
- **Identifiable + attributed.** Every upstream request sends a descriptive
  `User-Agent` with this repo's URL, and the UI credits both feeds.

Route lookups (adsbdb.com) are **per-callsign and edge-cached** (positive ~6 h,
negative ~30 min), so repeated traffic doesn't re-hit the route database.

If usage ever grows beyond personal scale, the next responsible steps would be:
honouring `Retry-After`, longer/shared route caching, and feeding data back to the
community projects (adsb.lol grants keys "by feeding").
