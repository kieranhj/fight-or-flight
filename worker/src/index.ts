/**
 * Aircraft Complaint Assistant — Cloudflare Worker data proxy.
 *
 * Phase 0: `GET /api/nearby` returns a hard-coded normalized sample with permissive
 * CORS so the GitHub Pages front-end can reach it. Phase 1 replaces the stub body
 * with a real call to api.airplanes.live (point endpoint), normalization, distance
 * sort, exclusion filters, ~8s caching and an adsb.lol fallback.
 *
 * The front-end talks ONLY to this Worker (Build Plan §2).
 */

export interface Env {
  /** Optional allow-list of front-end origins; '*' if unset (Phase 0 convenience). */
  ALLOWED_ORIGIN?: string
}

// Keep in sync with src/lib/adsb.ts (NormalizedFlight there).
type NormalizedFlight = {
  hex: string
  callsign: string | null
  registration: string | null
  type: string | null
  category: string | null
  altBaroFt: number | null
  altGeomFt: number | null
  groundSpeedKt: number | null
  track: number | null
  verticalRateFpm: number | null
  navAltitudeFt: number | null
  lat: number | null
  lon: number | null
  squawk: string | null
  distanceNm: number | null
  bearingDeg: number | null
}

function corsHeaders(env: Env): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': env.ALLOWED_ORIGIN ?? '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  }
}

function json(body: unknown, env: Env, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'public, max-age=8',
      ...corsHeaders(env),
    },
  })
}

/** Hard-coded sample so the front-end has a realistic shape to render in Phase 0. */
function sampleFlights(): NormalizedFlight[] {
  return [
    {
      hex: '4007f4',
      callsign: 'NJE7AB',
      registration: 'CS-DLB',
      type: 'GLF6',
      category: 'A2',
      altBaroFt: 3200,
      altGeomFt: 3300,
      groundSpeedKt: 212,
      track: 218,
      verticalRateFpm: 1408,
      navAltitudeFt: 6000,
      lat: 51.221,
      lon: -0.806,
      squawk: '7401',
      distanceNm: 2.7,
      bearingDeg: 41,
    },
    {
      hex: '4ca8d2',
      callsign: 'BAW283',
      registration: 'G-STBA',
      type: 'B77W',
      category: 'A5',
      altBaroFt: 4250,
      altGeomFt: 4400,
      groundSpeedKt: 247,
      track: 268,
      verticalRateFpm: -640,
      navAltitudeFt: 4000,
      lat: 51.205,
      lon: -0.74,
      squawk: '6155',
      distanceNm: 4.9,
      bearingDeg: 88,
    },
  ]
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(env) })
    }

    if (url.pathname === '/api/nearby') {
      if (request.method !== 'GET') {
        return json({ error: 'Method not allowed' }, env, 405)
      }

      const lat = Number(url.searchParams.get('lat'))
      const lon = Number(url.searchParams.get('lon'))
      const radiusNm = Number(url.searchParams.get('radius') ?? '10')
      const n = Number(url.searchParams.get('n') ?? '8')

      if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
        return json({ error: 'lat and lon query params are required numbers' }, env, 400)
      }

      return json(
        {
          query: { lat, lon, radiusNm, n },
          source: 'stub',
          generatedAt: Date.now(),
          flights: sampleFlights().slice(0, n),
        },
        env,
      )
    }

    if (url.pathname === '/' || url.pathname === '/health') {
      return json({ ok: true, service: 'aircraft-complaint-proxy', phase: 0 }, env)
    }

    return json({ error: 'Not found' }, env, 404)
  },
}
