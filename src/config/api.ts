// Worker endpoint config. The front-end talks ONLY to the Worker (Build Plan §2).
// Set VITE_WORKER_BASE at build time to point at your deployed Worker, e.g.
//   VITE_WORKER_BASE=https://aircraft-complaint-proxy.<acct>.workers.dev
// In dev it defaults to the local `wrangler dev` address.

export const WORKER_BASE: string =
  import.meta.env.VITE_WORKER_BASE ?? 'http://127.0.0.1:8787'

export const NEARBY_ENDPOINT = `${WORKER_BASE}/api/nearby`

/** Default query params for nearby lookups (tunable in Settings later). */
export const NEARBY_DEFAULTS = {
  radiusNm: 10,
  n: 8,
}

/**
 * The upstream feed the Phase 0 spike tests for direct browser reachability.
 * In production the Worker calls this server-side; the front-end never does.
 */
export const SPIKE_DIRECT_URL = (lat: number, lon: number, radiusNm: number) =>
  `https://api.airplanes.live/v2/point/${lat}/${lon}/${radiusNm}`
