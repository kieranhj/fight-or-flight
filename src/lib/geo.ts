import type { LatLon } from '../config/types'

// Geo helpers. Distances in nautical miles to match ADS-B conventions.
// (Phase 4 will add point-to-polyline distance here for corridor checks.)

const EARTH_RADIUS_NM = 3440.065

function toRad(deg: number): number {
  return (deg * Math.PI) / 180
}

function toDeg(rad: number): number {
  return (rad * 180) / Math.PI
}

/** Great-circle distance between two points, in nautical miles. */
export function haversineNm(a: LatLon, b: LatLon): number {
  const dLat = toRad(b.lat - a.lat)
  const dLon = toRad(b.lon - a.lon)
  const lat1 = toRad(a.lat)
  const lat2 = toRad(b.lat)
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2
  return 2 * EARTH_RADIUS_NM * Math.asin(Math.min(1, Math.sqrt(h)))
}

/** Initial bearing from `a` to `b`, in degrees (0–360, 0 = north). */
export function bearingDeg(a: LatLon, b: LatLon): number {
  const lat1 = toRad(a.lat)
  const lat2 = toRad(b.lat)
  const dLon = toRad(b.lon - a.lon)
  const y = Math.sin(dLon) * Math.cos(lat2)
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon)
  return (toDeg(Math.atan2(y, x)) + 360) % 360
}

/** Smallest absolute difference between two bearings, in degrees (0–180). */
export function angularDiff(a: number, b: number): number {
  const d = Math.abs(((a - b + 540) % 360) - 180)
  return d
}

// Local equirectangular projection to nm (east/north) relative to a reference.
// Accurate enough at terminal-area scales (a few tens of nm).
function toXY(p: LatLon, ref: LatLon): { x: number; y: number } {
  return {
    x: (p.lon - ref.lon) * Math.cos(toRad(ref.lat)) * 60,
    y: (p.lat - ref.lat) * 60,
  }
}

/** Perpendicular distance (nm) from a point to a single segment a→b. */
function pointToSegmentNm(p: LatLon, a: LatLon, b: LatLon): number {
  const P = toXY(p, p) // origin
  const A = toXY(a, p)
  const B = toXY(b, p)
  const abx = B.x - A.x
  const aby = B.y - A.y
  const lenSq = abx * abx + aby * aby
  let t = lenSq === 0 ? 0 : ((P.x - A.x) * abx + (P.y - A.y) * aby) / lenSq
  t = Math.max(0, Math.min(1, t))
  const cx = A.x + t * abx
  const cy = A.y + t * aby
  return Math.hypot(P.x - cx, P.y - cy)
}

/** Minimum lateral distance (nm) from a point to a polyline (its nearest segment). */
export function distanceToPolylineNm(p: LatLon, polyline: LatLon[]): number {
  if (polyline.length === 0) return Infinity
  if (polyline.length === 1) return haversineNm(p, polyline[0])
  let min = Infinity
  for (let i = 0; i < polyline.length - 1; i++) {
    const d = pointToSegmentNm(p, polyline[i], polyline[i + 1])
    if (d < min) min = d
  }
  return min
}
