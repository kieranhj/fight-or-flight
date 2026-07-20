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

import { USER_AGENT, fetchUpstream, isMilitary, num, str, type RawAircraft } from './shared'
import {
  captureMinute,
  compactHour,
  compactDay,
  captureHealth,
  previousHour,
  previousDay,
  dayTrack,
} from './capture'
import { rollupDay, queryFlights, queryStats, type HistoryEnv } from './rollup'

export interface Env extends HistoryEnv {
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
  /** True if the feed flags this as a military airframe (dbFlags bit 0). */
  military: boolean
  /** Origin/destination from the route lookup (adsbdb.com); null when unknown. */
  route: FlightRoute | null
}

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
    military: isMilitary(ac),
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

// ── Airport name resolution (ICAO → IATA / city name, via hexdb) ─────────────
type AirportMeta = { iata: string | null; name: string | null }
const AIRPORT_CACHE_TTL = 2_592_000 // 30 days — airports are static

/** Friendly "City Name (IATA)" label, falling back to IATA then ICAO. */
function friendlyLabel(icao: string | null, m: AirportMeta): string | null {
  const name = m.name ? m.name.replace(/\s+(International\s+)?Airport$/i, '').trim() : null
  if (name && m.iata) return `${name} (${m.iata})`
  return m.iata ?? name ?? icao
}

// In-isolate memo so one tap doesn't re-fetch a hub that several flights share.
const airportMemo = new Map<string, AirportMeta>()

async function resolveAirport(icao: string, ctx: ExecutionContext): Promise<AirportMeta> {
  const code = icao.trim().toUpperCase()
  if (!code) return { iata: null, name: null }
  const memo = airportMemo.get(code)
  if (memo) return memo
  const cache = caches.default
  const key = new Request(`https://cache.local/airport/${encodeURIComponent(code)}`)
  const hit = await cache.match(key)
  if (hit) {
    const meta = (await hit.json()) as AirportMeta
    airportMemo.set(code, meta)
    return meta
  }

  let meta: AirportMeta = { iata: null, name: null }
  try {
    const res = await fetch(`https://hexdb.io/api/v1/airport/icao/${encodeURIComponent(code)}`, {
      headers: { Accept: 'application/json', 'User-Agent': USER_AGENT },
    })
    if (res.ok) {
      const a = (await res.json()) as { iata?: string; airport?: string }
      meta = { iata: a.iata?.trim() || null, name: a.airport?.trim() || null }
    } else if (res.status !== 404) {
      return meta // transient — don't cache, allow a later retry
    }
  } catch {
    return meta
  }
  airportMemo.set(code, meta)
  ctx.waitUntil(
    cache.put(
      key,
      new Response(JSON.stringify(meta), {
        headers: { 'Content-Type': 'application/json', 'Cache-Control': `public, max-age=${AIRPORT_CACHE_TTL}` },
      }),
    ),
  )
  return meta
}

/** Replace a route's ICAO labels with friendly IATA / city names (in place). */
async function labelRoute(route: FlightRoute, ctx: ExecutionContext): Promise<void> {
  const blank: AirportMeta = { iata: null, name: null }
  const [o, d] = await Promise.all([
    route.originIcao ? resolveAirport(route.originIcao, ctx) : Promise.resolve(blank),
    route.destinationIcao ? resolveAirport(route.destinationIcao, ctx) : Promise.resolve(blank),
  ])
  route.originLabel = friendlyLabel(route.originIcao, o)
  route.destinationLabel = friendlyLabel(route.destinationIcao, d)
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
  // Resolve ICAO codes → friendly IATA / city-name labels (cached hard).
  if (hitData.route) await labelRoute(hitData.route, ctx)
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

// ── Request handling ─────────────────────────────────────────────────────────
// Upstream feed access lives in shared.ts (also used by the telemetry recorder).
// Responsible use: ONE attempt per feed, primary→fallback, no immediate retry.
// When both blip, we serve the 5-minute stale copy instead of generating load.
// Combined with the tap-only model and the ~8s edge cache, this keeps us well
// within airplanes.live's ~1 req/s, non-commercial terms.
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
    upstream = await fetchUpstream(lat, lon, radiusNm, env.UPSTREAM_BASE)
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

    // Production route lookup: GET /api/route-lookup?callsign=X → the same
    // cached per-callsign route resolution /api/nearby uses (edge cache + 429
    // backoff). Used by the replay flight card; cheap to call per tap.
    if (url.pathname === '/api/route-lookup') {
      const cs = url.searchParams.get('callsign')
      if (!cs) return json({ error: 'callsign query param required' }, env, 400)
      const r = await lookupRoute(cs, ctx)
      return json({ callsign: cs.trim().toUpperCase(), route: r.route }, env, 200, r.route ? 3600 : 300)
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

    // Diagnostic: GET /api/airport?icao=EGLL → raw hexdb airport lookup + parsed label.
    if (url.pathname === '/api/airport') {
      const icao = url.searchParams.get('icao')
      if (!icao) return json({ error: 'icao query param required' }, env, 400)
      const code = icao.trim().toUpperCase()
      const upstream = `https://hexdb.io/api/v1/airport/icao/${encodeURIComponent(code)}`
      try {
        const res = await fetch(upstream, {
          headers: { Accept: 'application/json', 'User-Agent': USER_AGENT },
        })
        const body = await res.text()
        let label: string | null = code
        try {
          const a = JSON.parse(body) as { iata?: string; airport?: string }
          label = friendlyLabel(code, { iata: a.iata?.trim() || null, name: a.airport?.trim() || null })
        } catch {
          /* body shown below */
        }
        return json({ icao: code, upstream, status: res.status, label, bodySample: body.slice(0, 400) }, env)
      } catch (err) {
        return json({ icao: code, upstream, error: String(err) }, env, 502)
      }
    }

    // Telemetry recorder health: last capture + yesterday's summary.
    if (url.pathname === '/api/history/health') {
      return json(await captureHealth(env, Date.now()), env)
    }

    // Ops/diagnostic: run a compaction stage by hand (idempotent — safe to
    // re-run; merges then deletes only already-merged source objects).
    //   /api/history/compact?hour=YYYY-MM-DDTHH   minutes → hour file
    //   /api/history/compact?day=YYYY-MM-DD       hours   → day file
    if (url.pathname === '/api/history/compact') {
      const hour = url.searchParams.get('hour')
      const day = url.searchParams.get('day')
      try {
        if (hour) return json(await compactHour(env, hour), env)
        if (day) return json(await compactDay(env, day), env)
        return json({ error: 'hour=YYYY-MM-DDTHH or day=YYYY-MM-DD required' }, env, 400)
      } catch (err) {
        return json({ error: String(err) }, env, 500)
      }
    }

    // Ops/backfill: sessionize one day's raw capture into D1 (idempotent —
    // deletes and re-inserts that day's rows). Runs nightly after compaction.
    if (url.pathname === '/api/history/rollup') {
      const day = url.searchParams.get('day')
      if (!day) return json({ error: 'day=YYYY-MM-DD required' }, env, 400)
      try {
        return json(await rollupDay(env, day), env)
      } catch (err) {
        return json({ error: String(err) }, env, 500)
      }
    }

    // Full NDJSON track file for one UTC day, for the replay view. Compacted
    // days are immutable (cache hard); staging days (today) merge live.
    //   /api/history/day/YYYY-MM-DD
    {
      const m = /^\/api\/history\/day\/(\d{4}-\d{2}-\d{2})$/.exec(url.pathname)
      if (m) {
        try {
          const track = await dayTrack(env, m[1])
          if (!track) return json({ error: `no capture recorded for ${m[1]}` }, env, 404)
          return new Response(track.body, {
            headers: {
              'Content-Type': 'application/x-ndjson; charset=utf-8',
              'Cache-Control': track.compacted ? 'public, max-age=604800' : 'public, max-age=60',
              ...corsHeaders(env),
            },
          })
        } catch (err) {
          return json({ error: String(err) }, env, 500)
        }
      }
    }

    // Flights for a day (+flags), optionally filtered.
    //   /api/history/flights?day=YYYY-MM-DD[&airport=EGLF][&flagged=1]
    if (url.pathname === '/api/history/flights') {
      if (!env.HISTORY) return json({ error: 'HISTORY D1 binding not configured' }, env, 500)
      const day = url.searchParams.get('day')
      if (!day) return json({ error: 'day=YYYY-MM-DD required' }, env, 400)
      return json(
        await queryFlights(env.HISTORY, {
          day,
          airport: url.searchParams.get('airport'),
          flagged: url.searchParams.get('flagged') === '1',
        }),
        env,
        200,
        60,
      )
    }

    // Daily stats over a date range: /api/history/stats?from=…&to=…
    if (url.pathname === '/api/history/stats') {
      if (!env.HISTORY) return json({ error: 'HISTORY D1 binding not configured' }, env, 500)
      const from = url.searchParams.get('from') ?? '2026-01-01'
      const to = url.searchParams.get('to') ?? '2099-12-31'
      return json(await queryStats(env.HISTORY, from, to), env, 200, 60)
    }

    if (url.pathname === '/' || url.pathname === '/health') {
      return json({ ok: true, service: 'aircraft-complaint-proxy', phase: 1 }, env)
    }

    return json({ error: 'Not found' }, env, 404)
  },

  // Telemetry recorder (docs/TELEMETRY-CAPTURE-PLAN.md): which job runs is
  // keyed on the cron expression that fired (must match wrangler.toml).
  async scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    const t = controller.scheduledTime
    if (controller.cron === '5 * * * *') {
      ctx.waitUntil(compactHour(env, previousHour(t)).catch((e) => console.log(`compactHour: ${e}`)))
    } else if (controller.cron === '15 0 * * *') {
      // Compact the day, then sessionize it into D1 (H2).
      ctx.waitUntil(
        compactDay(env, previousDay(t))
          .then(() => rollupDay(env, previousDay(t)))
          .catch((e) => console.log(`compactDay/rollup: ${e}`)),
      )
    } else {
      ctx.waitUntil(captureMinute(env, t).catch((e) => console.log(`capture: ${e}`)))
    }
  },
}
