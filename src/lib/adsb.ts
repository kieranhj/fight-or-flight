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
}

export type NearbyResponse = {
  /** Echoed query for debugging. */
  query: { lat: number; lon: number; radiusNm: number; n: number }
  /** Upstream source actually used (e.g. 'airplanes.live', 'adsb.lol', 'stub'). */
  source: string
  /** Server timestamp (ms epoch). */
  generatedAt: number
  flights: NormalizedFlight[]
}

export type NearbyParams = {
  lat: number
  lon: number
  radiusNm?: number
  n?: number
  signal?: AbortSignal
}

/** Call the Worker's /api/nearby and return the normalized response. */
export async function fetchNearby({
  lat,
  lon,
  radiusNm = NEARBY_DEFAULTS.radiusNm,
  n = NEARBY_DEFAULTS.n,
  signal,
}: NearbyParams): Promise<NearbyResponse> {
  const url = new URL(NEARBY_ENDPOINT)
  url.searchParams.set('lat', String(lat))
  url.searchParams.set('lon', String(lon))
  url.searchParams.set('radius', String(radiusNm))
  url.searchParams.set('n', String(n))

  const res = await fetch(url, { signal })
  if (!res.ok) {
    throw new Error(`Worker /api/nearby returned ${res.status} ${res.statusText}`)
  }
  return (await res.json()) as NearbyResponse
}
