import type { NormalizedFlight } from './adsb'
import type { Airport } from '../config/types'
import { AIRPORTS, AIRPORT_LIST } from '../config/airports'
import { CLASSIFY_THRESHOLDS, CALLSIGN_AIRPORT_HINTS } from '../config/classification'
import { haversineNm, bearingDeg, angularDiff } from './geo'

export type ClassifyBasis = 'route' | 'proximity' | 'callsign' | 'unknown'

export type Classification = {
  /** Owning airport, or null for transit/unknown. */
  airport: Airport['icao'] | null
  /** Display label: airport name, or a transit/unknown label. */
  label: string
  basis: ClassifyBasis
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
        indicative: false,
        reason: `${route.originLabel ?? '?'} → ${route.destinationLabel ?? '?'} — not a Farnborough/Heathrow/Gatwick movement.`,
      }
    }
  }

  // 3. No usable route → geometry: low and close to an airport ⇒ indicative match.
  if (f.lat != null && f.lon != null) {
    const pos = { lat: f.lat, lon: f.lon }
    const alt = f.altBaroFt
    let nearest: { airport: Airport; dNm: number } | null = null
    for (const a of AIRPORT_LIST) {
      const dNm = haversineNm(pos, a.position)
      if (!nearest || dNm < nearest.dNm) nearest = { airport: a, dNm }
    }
    const closeEnough = nearest && nearest.dNm <= CLASSIFY_THRESHOLDS.terminalRadiusNm
    const lowEnough = alt == null || alt <= CLASSIFY_THRESHOLDS.terminalMaxAltFt
    if (nearest && closeEnough && lowEnough) {
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
        indicative: true,
        reason: `${nearest.dNm.toFixed(1)} nm from ${nearest.airport.name}${altNote}${phase}. No route data — position-based guess.`,
      }
    }
  }

  // 4. Callsign-prefix hint (weakest; empty config by default).
  if (f.callsign) {
    const cs = f.callsign.toUpperCase()
    const hint = CALLSIGN_AIRPORT_HINTS.find((h) => cs.startsWith(h.prefix.toUpperCase()))
    if (hint) {
      return {
        airport: hint.airport,
        label: AIRPORTS[hint.airport].name,
        basis: 'callsign',
        indicative: true,
        reason: `Callsign prefix “${hint.prefix}” is associated with ${AIRPORTS[hint.airport].name}.`,
      }
    }
  }

  // 5. Unknown / transit — labelled, not guessed.
  const high = f.altBaroFt != null && f.altBaroFt >= CLASSIFY_THRESHOLDS.overflightAltFt
  return {
    airport: null,
    label: high ? 'Transit / overflight' : 'Transit / unknown',
    basis: 'unknown',
    indicative: true,
    reason: high
      ? 'High-altitude overflight; no route match to our airports.'
      : 'No route data and not within a terminal area of our airports.',
  }
}
