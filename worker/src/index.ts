/**
 * Aircraft Complaint Assistant — Cloudflare Worker data proxy.
 *
 * `GET /api/nearby?lat&lon&radius&n`
 *   1. calls api.airplanes.live point endpoint (fallback: api.adsb.lol),
 *   2. drops military / rotorcraft / light-GA via exclusion filters,
 *   3. normalizes ADSBExchange-v2 fields to NormalizedFlight,
 *   4. sorts by distance, trims to N,
 *   5. caches the result ~8s at the edge.
 *
 * The front-end talks ONLY to this Worker (Build Plan §2).
 */

export interface Env {
  /** Optional allow-list of front-end origins; '*' if unset. */
  ALLOWED_ORIGIN?: string
}

// ── Exclusion filters ───────────────────────────────────────────────────────
// MUST mirror src/config/filters.ts (kept here so the Worker stays self-contained
// and independently deployable). v1: keep fixed-wing jets (A2–A5/A6), drop
// military, rotorcraft (A7) and very light / hobbyist GA (A1).
const EXCLUDED_CATEGORIES = new Set(['A1', 'A7'])
const EXCLUDE_MILITARY = true
const EXCLUDED_TYPE_CODES = new Set<string>([]) // e.g. add light-GA ICAO type codes

// ── Normalized output shape (mirror of src/lib/adsb.ts NormalizedFlight) ─────
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
  onGround: boolean
}

/** Loose shape of an ADSBExchange-v2 aircraft record (airplanes.live / adsb.lol). */
type RawAircraft = Record<string, unknown>

// ── CORS / response helpers ──────────────────────────────────────────────────
function corsHeaders(env: Env): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': env.ALLOWED_ORIGIN ?? '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  }
}

function json(body: unknown, env: Env, status = 200, cacheSeconds = 0): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': cacheSeconds > 0 ? `public, max-age=${cacheSeconds}` : 'no-store',
      ...corsHeaders(env),
    },
  })
}

// ── Normalization ────────────────────────────────────────────────────────────
function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

function str(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const t = v.trim()
  return t.length > 0 ? t : null
}

/** Military bit (bit 0) of the ADSBExchange `dbFlags` bitfield. */
function isMilitary(ac: RawAircraft): boolean {
  const flags = ac.dbFlags
  return typeof flags === 'number' && (flags & 1) === 1
}

function isExcluded(ac: RawAircraft): boolean {
  if (EXCLUDE_MILITARY && isMilitary(ac)) return true
  const cat = str(ac.category)?.toUpperCase()
  if (cat && EXCLUDED_CATEGORIES.has(cat)) return true
  const type = str(ac.t)?.toUpperCase()
  if (type && EXCLUDED_TYPE_CODES.has(type)) return true
  return false
}

function normalize(ac: RawAircraft): NormalizedFlight {
  const onGround = ac.alt_baro === 'ground'
  return {
    hex: str(ac.hex) ?? '',
    callsign: str(ac.flight),
    registration: str(ac.r),
    type: str(ac.t),
    category: str(ac.category),
    altBaroFt: onGround ? null : num(ac.alt_baro),
    altGeomFt: num(ac.alt_geom),
    groundSpeedKt: num(ac.gs),
    track: num(ac.track),
    verticalRateFpm: num(ac.baro_rate) ?? num(ac.geom_rate),
    navAltitudeFt: num(ac.nav_altitude_mcp) ?? num(ac.nav_altitude_fms),
    lat: num(ac.lat),
    lon: num(ac.lon),
    squawk: str(ac.squawk),
    distanceNm: num(ac.dst),
    bearingDeg: num(ac.dir),
    onGround,
  }
}

// ── Upstream feeds ───────────────────────────────────────────────────────────
const UPSTREAMS = [
  { source: 'airplanes.live', url: (la: number, lo: number, r: number) => `https://api.airplanes.live/v2/point/${la}/${lo}/${r}` },
  { source: 'adsb.lol', url: (la: number, lo: number, r: number) => `https://api.adsb.lol/v2/point/${la}/${lo}/${r}` },
] as const

async function fetchUpstream(
  lat: number,
  lon: number,
  radiusNm: number,
): Promise<{ source: string; aircraft: RawAircraft[] }> {
  let lastError: unknown
  for (const up of UPSTREAMS) {
    try {
      const res = await fetch(up.url(lat, lon, radiusNm), {
        headers: {
          Accept: 'application/json',
          'User-Agent': 'aircraft-complaint-assistant (+github.com/kieranhj/fight-or-flight)',
        },
        // Let Cloudflare cache the upstream briefly too.
        cf: { cacheTtl: 8, cacheEverything: true },
      })
      if (!res.ok) {
        lastError = new Error(`${up.source} HTTP ${res.status}`)
        continue
      }
      const data = (await res.json()) as { ac?: RawAircraft[] }
      return { source: up.source, aircraft: Array.isArray(data.ac) ? data.ac : [] }
    } catch (err) {
      lastError = err
    }
  }
  throw lastError ?? new Error('all upstreams failed')
}

// ── Request handling ─────────────────────────────────────────────────────────
function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n))
}

/** Parse a query coordinate; NaN for missing/blank (Number(null) is 0, so guard). */
function parseCoord(raw: string | null): number {
  if (raw === null || raw.trim() === '') return NaN
  return Number(raw)
}

async function handleNearby(url: URL, env: Env, ctx: ExecutionContext): Promise<Response> {
  const lat = parseCoord(url.searchParams.get('lat'))
  const lon = parseCoord(url.searchParams.get('lon'))
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
    return json({ error: 'lat and lon query params are required and must be valid coordinates' }, env, 400)
  }
  // airplanes.live allows up to 250 nm; keep N sane.
  const radiusNm = clamp(Number(url.searchParams.get('radius') ?? '10') || 10, 1, 250)
  const n = clamp(Math.trunc(Number(url.searchParams.get('n') ?? '8') || 8), 1, 50)

  // Canonical cache key: round the position so nearby taps share a cached result.
  const rLat = lat.toFixed(3)
  const rLon = lon.toFixed(3)
  const cacheKey = new Request(
    `https://cache.local/api/nearby?lat=${rLat}&lon=${rLon}&radius=${radiusNm}&n=${n}`,
  )
  const cache = caches.default
  const cached = await cache.match(cacheKey)
  if (cached) return cached

  let upstream: { source: string; aircraft: RawAircraft[] }
  try {
    upstream = await fetchUpstream(lat, lon, radiusNm)
  } catch (err) {
    return json(
      { error: 'Upstream ADS-B feeds are unavailable', detail: String(err) },
      env,
      502,
    )
  }

  const flights = upstream.aircraft
    .filter((ac) => !isExcluded(ac))
    .map(normalize)
    .sort((a, b) => {
      // Closest first; nulls last.
      if (a.distanceNm == null) return 1
      if (b.distanceNm == null) return -1
      return a.distanceNm - b.distanceNm
    })
    .slice(0, n)

  const res = json(
    {
      query: { lat, lon, radiusNm, n },
      source: upstream.source,
      generatedAt: Date.now(),
      flights,
    },
    env,
    200,
    8,
  )
  ctx.waitUntil(cache.put(cacheKey, res.clone()))
  return res
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url)

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(env) })
    }

    if (url.pathname === '/api/nearby') {
      if (request.method !== 'GET') return json({ error: 'Method not allowed' }, env, 405)
      return handleNearby(url, env, ctx)
    }

    if (url.pathname === '/' || url.pathname === '/health') {
      return json({ ok: true, service: 'aircraft-complaint-proxy', phase: 1 }, env)
    }

    return json({ error: 'Not found' }, env, 404)
  },
}
