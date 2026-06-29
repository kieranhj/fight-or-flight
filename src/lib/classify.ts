import type { NormalizedFlight } from './adsb'
import type { Airport } from '../config/types'
import { AIRPORTS, AIRPORT_LIST } from '../config/airports'
import {
  CLASSIFY_THRESHOLDS,
  CALLSIGN_AIRPORT_HINTS,
  categoryFitsAirport,
} from '../config/classification'
import { haversineNm, bearingDeg, angularDiff } from './geo'
import { farnboroughTrajectory } from './trajectory'

export type ClassifyBasis = 'route' | 'proximity' | 'callsign' | 'unknown'

/**
 * Coarse group for display filtering:
 *  - an airport ICAO (EGLF/EGLL/EGKK) when it belongs to one of ours
 *  - 'transit'    known route, but between other airports (passing over)
 *  - 'overflight' unknown but high altitude (passing over)
 *  - 'unknown'    unknown and not high / not in a terminal area
 */
export type FlightGroup = Airport['icao'] | 'transit' | 'overflight' | 'unknown'

export type Classification = {
  /** Owning airport, or null for transit/unknown. */
  airport: Airport['icao'] | null
  /** Display label: airport name, or a transit/unknown label. */
  label: string
  basis: ClassifyBasis
  /** Coarse group, for the classification display filters. */
  group: FlightGroup
  /** True unless route-confirmed — geometric/callsign matches are best-effort. */
  indicative: boolean
  /** One-line explanation shown in the UI. */
  reason: string
}

const OUR_ICAOS = AIRPORT_LIST.map((a) => a.icao) as Airport['icao'][]

function ourAirport(icao: string | null): Airport['icao'] | null {
  return icao && (OUR_ICAOS as string[]).includes(icao) ? (icao as Airport['icao']) : null
}

/**
 * Decide which of EGLF/EGLL/EGKK a flight belongs to, or label it transit/unknown.
 * Order of evidence: route match (confident) → known route elsewhere (transit) →
 * proximity+altitude (indicative) → callsign hint (indicative) → unknown.
 * Anything not pinned down is labelled, never guessed.
 */
export function classifyFlight(f: NormalizedFlight): Classification {
  const route = f.route

  // 1. Route match to one of our airports — the only "confident" outcome.
  if (route) {
    const dest = ourAirport(route.destinationIcao)
    const orig = ourAirport(route.originIcao)
    const match = dest ?? orig
    if (match) {
      const arriving = dest != null
      return {
        airport: match,
        label: AIRPORTS[match].name,
        basis: 'route',
        group: match,
        indicative: false,
        reason: arriving
          ? `Route ${route.originLabel ?? '?'} → ${AIRPORTS[match].name} — arriving.`
          : `Route ${AIRPORTS[match].name} → ${route.destinationLabel ?? '?'} — departing.`,
      }
    }
    // 2. Route is known but to other airports → genuinely transit for us.
    if (route.originIcao || route.destinationIcao) {
      return {
        airport: null,
        label: 'Transit',
        basis: 'unknown',
        group: 'transit',
        indicative: false,
        reason: `${route.originLabel ?? '?'} → ${route.destinationLabel ?? '?'} — not a Farnborough/Heathrow/Gatwick movement.`,
      }
    }
  }

  // 3. No usable route → trajectory heuristic: a route-less biz jet whose motion
  // and corridor alignment mark it as arriving/departing Farnborough. Runs before
  // the simpler proximity check so we catch inbound/outbound jets earlier (and
  // further out) than the 15 nm terminal radius. Indicative.
  const traj = farnboroughTrajectory(f)
  if (traj.phase) {
    return {
      airport: 'EGLF',
      label: AIRPORTS.EGLF.name,
      basis: 'proximity',
      group: 'EGLF',
      indicative: true,
      reason: traj.reason,
    }
  }

  // 4. Still no match → geometry: low and close to an airport ⇒ indicative match.
  if (f.lat != null && f.lon != null) {
    const pos = { lat: f.lat, lon: f.lon }
    const alt = f.altBaroFt
    let nearest: { airport: Airport; dNm: number } | null = null
    for (const a of AIRPORT_LIST) {
      // Skip airports too small for this aircraft (e.g. a heavy can't be a
      // Farnborough movement) — avoids proximity false positives.
      if (!categoryFitsAirport(f.category, a.icao)) continue
      const dNm = haversineNm(pos, a.position)
      if (!nearest || dNm < nearest.dNm) nearest = { airport: a, dNm }
    }
    const closeEnough = nearest && nearest.dNm <= CLASSIFY_THRESHOLDS.terminalRadiusNm
    const lowEnough = alt == null || alt <= CLASSIFY_THRESHOLDS.terminalMaxAltFt
    // Reject low-and-far traffic flying well below any approach/departure profile —
    // a hobbyist GA aircraft transiting at ~1,500 ft several nm out is not a movement.
    const profileFloorFt =
      (nearest?.airport.elevationFt ?? 0) +
      Math.max(0, (nearest?.dNm ?? 0) - CLASSIFY_THRESHOLDS.terminalNearFieldNm) *
        CLASSIFY_THRESHOLDS.terminalProfileFtPerNm
    const onProfile = alt == null || alt >= profileFloorFt
    if (nearest && closeEnough && lowEnough && onProfile) {
      let phase = ''
      if (f.track != null) {
        const toAirport = bearingDeg(pos, nearest.airport.position)
        phase =
          angularDiff(f.track, toAirport) <= CLASSIFY_THRESHOLDS.headingToleranceDeg
            ? ' heading toward (likely arrival)'
            : ' heading away (likely departure)'
      }
      const altNote = alt != null ? `, ${alt.toLocaleString()} ft` : ''
      return {
        airport: nearest.airport.icao,
        label: nearest.airport.name,
        basis: 'proximity',
        group: nearest.airport.icao,
        indicative: true,
        reason: `${nearest.dNm.toFixed(1)} nm from ${nearest.airport.name}${altNote}${phase}. No route data — position-based guess.`,
      }
    }
  }

  // 5. Callsign-prefix hint (weakest; empty config by default).
  if (f.callsign) {
    const cs = f.callsign.toUpperCase()
    const hint = CALLSIGN_AIRPORT_HINTS.find((h) => cs.startsWith(h.prefix.toUpperCase()))
    if (hint) {
      return {
        airport: hint.airport,
        label: AIRPORTS[hint.airport].name,
        basis: 'callsign',
        group: hint.airport,
        indicative: true,
        reason: `Callsign prefix “${hint.prefix}” is associated with ${AIRPORTS[hint.airport].name}.`,
      }
    }
  }

  // 6. Unknown / transit — labelled, not guessed.
  const high = f.altBaroFt != null && f.altBaroFt >= CLASSIFY_THRESHOLDS.overflightAltFt
  return {
    airport: null,
    label: high ? 'Transit / overflight' : 'Transit / unknown',
    basis: 'unknown',
    group: high ? 'overflight' : 'unknown',
    indicative: true,
    reason: high
      ? 'High-altitude overflight; no route match to our airports.'
      : 'No route data and not within a terminal area of our airports.',
  }
}
