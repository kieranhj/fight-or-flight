// Worker endpoint config. The front-end talks ONLY to the Worker (Build Plan §2).
// Set VITE_WORKER_BASE at build time to point at your deployed Worker, e.g.
//   VITE_WORKER_BASE=https://aircraft-complaint-proxy.<acct>.workers.dev
// In dev it defaults to the local `wrangler dev` address.

// Resolve the Worker base robustly. CI injects `VITE_WORKER_BASE` even when the
// repo variable is unset, so it can arrive as "" — `??` would NOT fall back on an
// empty string, producing a relative "/api/nearby" that throws "Invalid URL".
// We also tolerate a hostname pasted without a scheme and strip trailing slashes.
function resolveWorkerBase(): string {
  const raw = import.meta.env.VITE_WORKER_BASE?.trim()
  if (!raw) return 'http://127.0.0.1:8787'
  const withScheme = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`
  return withScheme.replace(/\/+$/, '')
}

export const WORKER_BASE: string = resolveWorkerBase()

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
