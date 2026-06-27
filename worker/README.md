# Worker — Fight or Flight data proxy

A thin Cloudflare Worker that the front-end talks to instead of calling ADS-B
feeds directly. It solves CORS, smooths upstream rate limits via short caching,
and keeps room for server-side route enrichment and future API keys.

## Endpoints

| Method | Path | Phase 0 behaviour |
|---|---|---|
| `GET` | `/api/nearby?lat&lon&radius&n` | Returns a hard-coded normalized sample with CORS. |
| `GET` | `/health` | Liveness JSON. |
| `OPTIONS` | `*` | CORS preflight (204). |

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

If usage ever grows beyond personal scale, the next responsible steps would be:
per-callsign route caching (cut routeset calls), honouring `Retry-After`, and
feeding data back to the community projects (adsb.lol grants keys "by feeding").
