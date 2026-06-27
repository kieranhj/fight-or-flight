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
