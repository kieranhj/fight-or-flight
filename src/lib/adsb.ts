import { NEARBY_ENDPOINT, NEARBY_DEFAULTS } from '../config/api'

// Normalized flight shape returned by the Worker's /api/nearby. The Worker maps
// raw ADSBExchange-v2 fields onto this; the front-end only ever sees this shape.
// Keep in sync with worker/src/index.ts (NormalizedFlight there).
export type NormalizedFlight = {
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
  /** Distance from the query point in nautical miles (`dst`). */
  distanceNm: number | null
  /** Bearing from the query point in degrees (`dir`). */
  bearingDeg: number | null
  /** True when the feed reported `alt_baro: "ground"`. */
  onGround: boolean
  /** Origin/destination from the Worker's route lookup (adsbdb.com); null when unknown. */
  route: FlightRoute | null
}

/** Origin/destination airports for a flight, from the route-database lookup. */
export type FlightRoute = {
  originIcao: string | null
  destinationIcao: string | null
  originLabel: string | null
  destinationLabel: string | null
}

export type NearbyResponse = {
  /** Echoed query for debugging. */
  query: { lat: number; lon: number; radiusNm: number; n: number }
  /** Upstream source actually used (e.g. 'airplanes.live', 'adsb.lol', 'stub'). */
  source: string
  /** Server timestamp (ms epoch). */
  generatedAt: number
  /** True when the feeds momentarily failed and the Worker served last-good data. */
  stale?: boolean
  flights: NormalizedFlight[]
}

export type NearbyParams = {
  lat: number
  lon: number
  radiusNm?: number
  n?: number
  /** Opt-ins to include normally-filtered categories (default: all off). */
  include?: { military?: boolean; rotorcraft?: boolean; light?: boolean }
  signal?: AbortSignal
}

/** Call the Worker's /api/nearby and return the normalized response. */
export async function fetchNearby({
  lat,
  lon,
  radiusNm = NEARBY_DEFAULTS.radiusNm,
  n = NEARBY_DEFAULTS.n,
  include,
  signal,
}: NearbyParams): Promise<NearbyResponse> {
  const url = new URL(NEARBY_ENDPOINT)
  url.searchParams.set('lat', String(lat))
  url.searchParams.set('lon', String(lon))
  url.searchParams.set('radius', String(radiusNm))
  url.searchParams.set('n', String(n))
  if (include?.military) url.searchParams.set('mil', '1')
  if (include?.rotorcraft) url.searchParams.set('rotor', '1')
  if (include?.light) url.searchParams.set('light', '1')

  const res = await fetch(url, { signal })
  if (!res.ok) {
    // 5xx ⇒ the upstream ADS-B feeds are momentarily unavailable (rate-limit /
    // outage) and even the Worker's last-good cache was empty. Keep it friendly.
    if (res.status >= 500) {
      throw new Error('The aircraft feeds are momentarily unavailable. Tap to try again.')
    }
    throw new Error(`Request failed (${res.status}).`)
  }
  return (await res.json()) as NearbyResponse
}
