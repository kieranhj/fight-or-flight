/**
 * Fight or Flight — Cloudflare Worker data proxy.
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
const EXCLUDE_ON_GROUND = true // app is about overhead noise; drop parked/taxiing traffic
const EXCLUDED_TYPE_CODES = new Set<string>([]) // e.g. add light-GA ICAO type codes

// ── Normalized output shape (mirror of src/lib/adsb.ts NormalizedFlight) ─────
type FlightRoute = {
  originIcao: string | null
  destinationIcao: string | null
  /** Short display label (IATA or name) for origin/destination, when available. */
  originLabel: string | null
  destinationLabel: string | null
}

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
  /** Origin/destination from adsb.lol routeset; null when unknown. */
  route: FlightRoute | null
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
  if (EXCLUDE_ON_GROUND && ac.alt_baro === 'ground') return true
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
    route: null, // filled in by enrichRoutes() after sort/trim
  }
}

// ── Route enrichment (adsb.lol routeset) ─────────────────────────────────────
type RoutesetAirport = { icao?: string; iata?: string; name?: string }
type RoutesetItem = {
  callsign?: string
  plane_found?: boolean
  _airports?: RoutesetAirport[]
}

function airportLabel(a: RoutesetAirport | undefined): string | null {
  if (!a) return null
  return a.iata ?? a.name ?? a.icao ?? null
}

/**
 * Look up origin/destination for the given flights in one batched routeset call.
 * Best-effort: any failure leaves routes null rather than failing the request.
 * Mutates `flights` in place (only those with a callsign and a position).
 */
async function enrichRoutes(flights: NormalizedFlight[]): Promise<void> {
  const planes = flights
    .filter((f) => f.callsign && f.lat != null && f.lon != null)
    .map((f) => ({ callsign: f.callsign as string, lat: f.lat as number, lng: f.lon as number }))
  if (planes.length === 0) return

  let items: RoutesetItem[]
  try {
    const res = await fetch('https://api.adsb.lol/api/0/routeset', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'User-Agent': 'fight-or-flight (+github.com/kieranhj/fight-or-flight)',
      },
      body: JSON.stringify({ planes }),
    })
    if (!res.ok) return
    items = (await res.json()) as RoutesetItem[]
  } catch {
    return
  }
  if (!Array.isArray(items)) return

  const byCallsign = new Map<string, RoutesetItem>()
  for (const it of items) {
    if (it.callsign) byCallsign.set(it.callsign.trim(), it)
  }

  for (const f of flights) {
    if (!f.callsign) continue
    const it = byCallsign.get(f.callsign)
    const airports = it?._airports
    if (!it?.plane_found || !airports || airports.length === 0) continue
    const origin = airports[0]
    const destination = airports[airports.length - 1]
    f.route = {
      originIcao: origin?.icao ?? null,
      destinationIcao: destination?.icao ?? null,
      originLabel: airportLabel(origin),
      destinationLabel: airportLabel(destination),
    }
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
  rounds = 2,
): Promise<{ source: string; aircraft: RawAircraft[] }> {
  let lastError: unknown
  // Try the whole primary→fallback chain up to `rounds` times to ride over a
  // transient blip on both feeds (rate-limit / 5xx / dropped connection).
  for (let round = 0; round < rounds; round++) {
    for (const up of UPSTREAMS) {
      try {
        const res = await fetch(up.url(lat, lon, radiusNm), {
          headers: {
            Accept: 'application/json',
            'User-Agent': 'fight-or-flight (+github.com/kieranhj/fight-or-flight)',
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
  const baseKey = `https://cache.local/api/nearby?lat=${rLat}&lon=${rLon}&radius=${radiusNm}&n=${n}`
  const cacheKey = new Request(baseKey)
  // Longer-lived copy of the last good result, served if the feeds blip.
  const staleKey = new Request(`${baseKey}&stale=1`)
  const cache = caches.default
  const cached = await cache.match(cacheKey)
  if (cached) return cached

  let upstream: { source: string; aircraft: RawAircraft[] }
  try {
    upstream = await fetchUpstream(lat, lon, radiusNm)
  } catch (err) {
    // Stale-on-error: return the last good data (≤ 5 min old) rather than a 502.
    const stale = await cache.match(staleKey)
    if (stale) {
      const data = (await stale.json()) as Record<string, unknown>
      data.stale = true
      return json(data, env, 200, 0)
    }
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

  // Enrich only the trimmed list (≤ n) with route data — one batched call.
  await enrichRoutes(flights)

  const payload = {
    query: { lat, lon, radiusNm, n },
    source: upstream.source,
    generatedAt: Date.now(),
    stale: false,
    flights,
  }
  const res = json(payload, env, 200, 8)
  ctx.waitUntil(cache.put(cacheKey, res.clone()))
  // Keep a 5-minute stale copy for the error path above.
  ctx.waitUntil(cache.put(staleKey, json(payload, env, 200, 300)))
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
