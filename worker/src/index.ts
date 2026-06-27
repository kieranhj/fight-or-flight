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
// Defaults mirror src/config/filters.ts (kept here so the Worker stays
// self-contained). By default we keep fixed-wing jets (A2–A6) and drop military,
// rotorcraft (A7) and very light / hobbyist GA (A1). The client can opt these
// categories back IN per-request via query params (see FilterOpts) — on-ground
// traffic is always dropped (the app is about overhead noise).
const EXCLUDE_ON_GROUND = true
const EXCLUDED_TYPE_CODES = new Set<string>([]) // e.g. add light-GA ICAO type codes

/** Per-request opt-ins to include normally-filtered categories (default: all off). */
type FilterOpts = { includeMilitary: boolean; includeRotorcraft: boolean; includeLight: boolean }

/** Sent on every upstream request so feed operators can identify / contact us. */
const USER_AGENT = 'fight-or-flight (+github.com/kieranhj/fight-or-flight)'

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
  /** Origin/destination from the route lookup (adsbdb.com); null when unknown. */
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

function isExcluded(ac: RawAircraft, opts: FilterOpts): boolean {
  if (EXCLUDE_ON_GROUND && ac.alt_baro === 'ground') return true
  if (!opts.includeMilitary && isMilitary(ac)) return true
  const cat = str(ac.category)?.toUpperCase()
  if (cat === 'A7' && !opts.includeRotorcraft) return true // rotorcraft
  if (cat === 'A1' && !opts.includeLight) return true // light / hobbyist GA
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

// ── Route enrichment ─────────────────────────────────────────────────────────
// Raw ADS-B carries no origin/destination — those come from a callsign→route
// database. These free DBs rate-limit by IP, and Cloudflare Workers egress from
// SHARED IPs, so a provider can 429 us regardless of our own (low) usage. We
// therefore: cache hard (routes are static), serialise lookups, and back off
// globally on a 429 so we never amplify it. `ROUTE_PROVIDER` selects the source;
// the /api/route diagnostic probes all of them so we can pick one that works from
// the deployed Worker.
type RouteProvider = 'adsbdb' | 'adsblol' | 'hexdb'
// hexdb is the one reachable from Cloudflare's shared egress IPs without being
// rate-limited (adsbdb 429s the IP; adsb.lol routeset returns 201/empty for us).
const ROUTE_PROVIDER: RouteProvider = 'hexdb'

const ROUTE_CACHE_TTL = 21_600 // 6h for a known route
const ROUTE_NEG_TTL = 1_800 // 30m for an unknown callsign
const ROUTE_BACKOFF_TTL = 300 // pause hitting the provider after a 429
const BACKOFF_KEY = 'https://cache.local/route-backoff'

type ProviderHit = { status: number; route: FlightRoute | null; body: string }

/** Fetch + parse one provider for one callsign. Throws only on network error. */
async function fetchProvider(provider: RouteProvider, cs: string): Promise<ProviderHit> {
  const ua = { Accept: 'application/json', 'User-Agent': USER_AGENT }
  if (provider === 'hexdb') {
    const res = await fetch(`https://hexdb.io/api/v1/route/icao/${encodeURIComponent(cs)}`, { headers: ua })
    const body = await res.text()
    let route: FlightRoute | null = null
    try {
      // hexdb returns e.g. {"flight":"BAW117","route":"EGLL-KJFK",...}; multi-leg
      // routes look like "EGKK-LEMG-EGKK" — take first origin and final destination.
      const r = (JSON.parse(body) as { route?: string }).route
      const parts = r ? r.split('-').filter(Boolean) : []
      if (parts.length >= 2 && !/unknown/i.test(r ?? '')) {
        const o = parts[0]
        const d = parts[parts.length - 1]
        route = { originIcao: o, destinationIcao: d, originLabel: o, destinationLabel: d }
      }
    } catch { /* body shown in diagnostic */ }
    return { status: res.status, route, body }
  }
  if (provider === 'adsblol') {
    const res = await fetch('https://api.adsb.lol/api/0/routeset', {
      method: 'POST',
      headers: { ...ua, 'Content-Type': 'application/json' },
      body: JSON.stringify({ planes: [{ callsign: cs, lat: 51.47, lng: -0.45 }] }),
    })
    const body = await res.text()
    let route: FlightRoute | null = null
    try {
      const items = JSON.parse(body) as { _airports?: { icao?: string; iata?: string; name?: string }[]; plane_found?: boolean }[]
      const a = Array.isArray(items) ? items[0]?._airports : undefined
      if (a && a.length) {
        const o = a[0]
        const d = a[a.length - 1]
        route = {
          originIcao: o?.icao ?? null,
          destinationIcao: d?.icao ?? null,
          originLabel: o?.iata ?? o?.name ?? o?.icao ?? null,
          destinationLabel: d?.iata ?? d?.name ?? d?.icao ?? null,
        }
      }
    } catch { /* body shown in diagnostic */ }
    return { status: res.status, route, body }
  }
  // adsbdb (default)
  const res = await fetch(`https://api.adsbdb.com/v0/callsign/${encodeURIComponent(cs)}`, { headers: ua })
  const body = await res.text()
  let route: FlightRoute | null = null
  try {
    const fr = (JSON.parse(body) as {
      response?: { flightroute?: { origin?: AdsbdbAirport; destination?: AdsbdbAirport } }
    }).response?.flightroute
    if (fr && (fr.origin || fr.destination)) {
      route = {
        originIcao: fr.origin?.icao_code ?? null,
        destinationIcao: fr.destination?.icao_code ?? null,
        originLabel: adsbdbLabel(fr.origin),
        destinationLabel: adsbdbLabel(fr.destination),
      }
    }
  } catch { /* body shown in diagnostic */ }
  return { status: res.status, route, body }
}

type AdsbdbAirport = { icao_code?: string; iata_code?: string; name?: string; municipality?: string }
function adsbdbLabel(a: AdsbdbAirport | undefined): string | null {
  if (!a) return null
  return a.iata_code ?? a.municipality ?? a.name ?? a.icao_code ?? null
}

type RouteResult = { route: FlightRoute | null; rateLimited: boolean }

/** Look up one callsign's route via ROUTE_PROVIDER, with caching + 429 backoff. */
async function lookupRoute(callsign: string, ctx: ExecutionContext): Promise<RouteResult> {
  const cs = callsign.trim().toUpperCase()
  if (!cs) return { route: null, rateLimited: false }
  const cache = caches.default
  const key = new Request(`https://cache.local/route/${ROUTE_PROVIDER}/${encodeURIComponent(cs)}`)
  const hit = await cache.match(key)
  if (hit) return { route: ((await hit.json()) as { route: FlightRoute | null }).route, rateLimited: false }
  if (await cache.match(new Request(BACKOFF_KEY))) return { route: null, rateLimited: true }

  let hitData: ProviderHit
  try {
    hitData = await fetchProvider(ROUTE_PROVIDER, cs)
  } catch {
    return { route: null, rateLimited: false } // network blip — don't cache
  }

  if (hitData.status === 429) {
    ctx.waitUntil(
      cache.put(
        new Request(BACKOFF_KEY),
        new Response('1', { headers: { 'Cache-Control': `public, max-age=${ROUTE_BACKOFF_TTL}` } }),
      ),
    )
    return { route: null, rateLimited: true }
  }
  // 200 with a route → cache long; 200/404 with none → cache short; other → don't cache.
  const ok2xx = hitData.status >= 200 && hitData.status < 300
  if (!ok2xx && hitData.status !== 404) return { route: null, rateLimited: false }
  const ttl = hitData.route ? ROUTE_CACHE_TTL : ROUTE_NEG_TTL
  ctx.waitUntil(
    cache.put(
      key,
      new Response(JSON.stringify({ route: hitData.route }), {
        headers: { 'Content-Type': 'application/json', 'Cache-Control': `public, max-age=${ttl}` },
      }),
    ),
  )
  return { route: hitData.route, rateLimited: false }
}

/**
 * Fill origin/destination for each flight with a callsign. Serialised so a 429
 * short-circuits the rest (don't amplify rate limits). Best-effort: failures
 * leave a flight's route null rather than failing the request.
 */
async function enrichRoutes(flights: NormalizedFlight[], ctx: ExecutionContext): Promise<void> {
  let rateLimited = false
  for (const f of flights) {
    if (!f.callsign || rateLimited) continue
    const r = await lookupRoute(f.callsign, ctx)
    if (r.rateLimited) rateLimited = true
    else f.route = r.route
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
  // Responsible use: ONE attempt per feed, primary→fallback, no immediate retry.
  // We never re-hit a feed that just failed (especially a 429) — when both blip,
  // the caller serves the 5-minute stale copy instead of generating more load.
  // Combined with the tap-only model (no polling) and the ~8s edge cache, this
  // keeps us comfortably within airplanes.live's ~1 req/s, non-commercial terms.
  for (const up of UPSTREAMS) {
    try {
      const res = await fetch(up.url(lat, lon, radiusNm), {
        headers: {
          Accept: 'application/json',
          'User-Agent': 'fight-or-flight (+github.com/kieranhj/fight-or-flight)',
        },
        // Let Cloudflare cache the upstream briefly too, to dedupe load.
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
  const filterOpts: FilterOpts = {
    includeMilitary: url.searchParams.get('mil') === '1',
    includeRotorcraft: url.searchParams.get('rotor') === '1',
    includeLight: url.searchParams.get('light') === '1',
  }

  // Canonical cache key: round the position so nearby taps share a cached result.
  // Filter opt-ins change the result set, so they're part of the key.
  const rLat = lat.toFixed(3)
  const rLon = lon.toFixed(3)
  const f = `${filterOpts.includeMilitary ? 1 : 0}${filterOpts.includeRotorcraft ? 1 : 0}${filterOpts.includeLight ? 1 : 0}`
  const baseKey = `https://cache.local/api/nearby?lat=${rLat}&lon=${rLon}&radius=${radiusNm}&n=${n}&f=${f}`
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
    .filter((ac) => !isExcluded(ac, filterOpts))
    .map(normalize)
    .sort((a, b) => {
      // Closest first; nulls last.
      if (a.distanceNm == null) return 1
      if (b.distanceNm == null) return -1
      return a.distanceNm - b.distanceNm
    })
    .slice(0, n)

  // Enrich only the trimmed list (≤ n) with route data (parallel, edge-cached).
  await enrichRoutes(flights, ctx)

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

    // Diagnostic: GET /api/route?callsign=BAW117 → probes ALL route providers fresh
    // (bypassing cache) and returns each one's status, parsed route and body sample,
    // so we can pick a source that works from the deployed Worker. Try a known-good
    // callsign like PGT821.
    if (url.pathname === '/api/route') {
      const cs = url.searchParams.get('callsign')
      if (!cs) return json({ error: 'callsign query param required' }, env, 400)
      const target = cs.trim().toUpperCase()
      const providers: RouteProvider[] = ['adsbdb', 'adsblol', 'hexdb']
      const results = await Promise.all(
        providers.map(async (p) => {
          try {
            const h = await fetchProvider(p, target)
            return { provider: p, status: h.status, route: h.route, bodySample: h.body.slice(0, 400) }
          } catch (err) {
            return { provider: p, error: String(err) }
          }
        }),
      )
      return json({ callsign: target, active: ROUTE_PROVIDER, providers: results }, env)
    }

    if (url.pathname === '/' || url.pathname === '/health') {
      return json({ ok: true, service: 'aircraft-complaint-proxy', phase: 1 }, env)
    }

    return json({ error: 'Not found' }, env, 404)
  },
}
