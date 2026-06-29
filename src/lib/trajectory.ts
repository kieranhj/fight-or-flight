import type { NormalizedFlight } from './adsb'
import { AIRPORTS } from '../config/airports'
import { CORRIDORS } from '../config/corridors'
import { TRAJECTORY_THRESHOLDS as T, categoryFitsAirport } from '../config/classification'
import { haversineNm, bearingDeg, angularDiff, pointInPolygon } from './geo'

// Farnborough arrival/descent trajectory heuristic (docs/ASCENT-DESCENT-HEURISTIC.md).
// Route-less biz jets are inferred as arriving/departing Farnborough from their
// motion plus point-in-polygon membership of the real WebTrak corridor swaths.
// Corridor alignment is REQUIRED (the discriminator vs nearby Heathrow/Gatwick
// traffic); a confirming motion/heading signal then meets the score threshold.
// Always indicative — classify.ts only calls this when no route confirms an airport.

export type TrajectoryPhase = 'arrival' | 'departure'
export type TrajectoryResult = { phase: TrajectoryPhase | null; score: number; reason: string }

const NONE: TrajectoryResult = { phase: null, score: 0, reason: '' }

const EGLF = AIRPORTS.EGLF
const ARRIVAL_SWATHS = CORRIDORS.filter((c) => c.airport === 'EGLF' && c.kind === 'arrival')
const DEPARTURE_SWATHS = CORRIDORS.filter((c) => c.airport === 'EGLF' && c.kind === 'departure')

const insideAny = (pos: { lat: number; lon: number }, swaths: typeof CORRIDORS) =>
  swaths.some((c) => pointInPolygon(pos, c.polygon))

/**
 * Infer whether a route-less flight is arriving at / departing Farnborough from its
 * trajectory. Returns `{ phase: null }` unless corridor-aligned with a confirming
 * signal. The higher-scoring phase wins if both somehow qualify.
 */
export function farnboroughTrajectory(f: NormalizedFlight): TrajectoryResult {
  if (f.lat == null || f.lon == null) return NONE
  // Size ceiling: a heavy near Farnborough is an overflight, not a movement.
  if (!categoryFitsAirport(f.category, 'EGLF')) return NONE

  const pos = { lat: f.lat, lon: f.lon }
  const dNm = haversineNm(pos, EGLF.position)
  const alt = f.altBaroFt
  const vr = f.verticalRateFpm
  const track = f.track

  const arrival = scoreArrival(pos, dNm, alt, vr, track, f.navAltitudeFt)
  const departure = scoreDeparture(pos, dNm, alt, vr, track)

  // A flight is climbing or descending, not both, so these rarely both fire; if
  // they do, take the stronger.
  const best = arrival.score >= departure.score ? arrival : departure
  return best
}

function scoreArrival(
  pos: { lat: number; lon: number },
  dNm: number,
  alt: number | null,
  vr: number | null,
  track: number | null,
  navAlt: number | null,
): TrajectoryResult {
  if (dNm > T.arrivalMaxDistanceNm) return NONE
  if (alt != null && alt > T.arrivalMaxAltFt) return NONE
  const aligned = insideAny(pos, ARRIVAL_SWATHS)
  if (!aligned) return NONE // corridor membership is mandatory

  const toField = bearingDeg(pos, EGLF.position)
  const descending = vr != null && vr < T.descentRateFpm
  const headingToward = track != null && angularDiff(track, toField) <= T.headingToleranceDeg
  const selectedAltLow = navAlt != null && navAlt <= T.selectedAltLowFt

  let score = T.score.corridor
  if (descending) score += T.score.descent
  if (headingToward) score += T.score.heading
  if (selectedAltLow) score += T.score.selectedAltLow
  if (score < T.arrivalScoreThreshold) return NONE

  const parts: string[] = ['inside a published arrival corridor']
  if (descending) parts.push(alt != null ? `descending through ${alt.toLocaleString()} ft` : 'descending')
  if (headingToward) parts.push('tracking the field')
  if (selectedAltLow) parts.push('vectored low')
  return {
    phase: 'arrival',
    score,
    reason: `${dNm.toFixed(1)} nm out, ${parts.join(', ')} — likely Farnborough arrival (indicative).`,
  }
}

function scoreDeparture(
  pos: { lat: number; lon: number },
  dNm: number,
  alt: number | null,
  vr: number | null,
  track: number | null,
): TrajectoryResult {
  if (dNm > T.departureMaxDistanceNm) return NONE
  if (alt != null && alt > T.departureMaxAltFt) return NONE
  const aligned = insideAny(pos, DEPARTURE_SWATHS)
  if (!aligned) return NONE // corridor membership is mandatory

  const fromField = bearingDeg(EGLF.position, pos)
  const climbing = vr != null && vr > T.climbRateFpm
  const headingAway = track != null && angularDiff(track, fromField) <= T.headingToleranceDeg

  let score = T.score.corridor
  if (climbing) score += T.score.climb
  if (headingAway) score += T.score.heading
  if (score < T.departureScoreThreshold) return NONE

  const parts: string[] = ['inside a published departure corridor']
  if (climbing) parts.push(alt != null ? `climbing through ${alt.toLocaleString()} ft` : 'climbing')
  if (headingAway) parts.push('tracking outbound')
  return {
    phase: 'departure',
    score,
    reason: `${dNm.toFixed(1)} nm out, ${parts.join(', ')} — likely Farnborough departure (indicative).`,
  }
}
