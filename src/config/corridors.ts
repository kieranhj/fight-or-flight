import type { Airport, LatLon } from './types'

// Seed corridor geometry from Build Plan §7. These are ROUGH centrelines for the
// indicative R3 (corridor-proximity) and context for R2 (altitude-floor) rules.
// They are NOT real AIP waypoints — replace with published RNAV SID/STAR
// coordinates in Phase 6. Everything here is deliberately approximate.

export type Corridor = {
  id: string
  airport: Airport['icao']
  label: string
  /** Ordered centreline points (rough). Lateral offset beyond `toluranceNm` => indicative flag. */
  centreline: LatLon[]
  /** Lateral tolerance in nautical miles before R3 flags "off designated track". */
  toleranceNm: number
  /**
   * Design altitude target along this corridor, in feet AMSL, used by R2 as an
   * indicative floor. e.g. "≥ 4,000 ft over the Hog's Back / A31".
   */
  designAltitudeFt?: number
  note?: string
}

export const CORRIDORS: Corridor[] = [
  {
    id: 'EGLF-RW24-SOUTH-DEP',
    airport: 'EGLF',
    label: 'Farnborough Rwy 24 southerly departures (GWC/HAZEL SIDs)',
    // Rough: depart 24, climb ahead, turn left ~220° after ~1,150 ft. Points are
    // a hand-drawn approximation from the airport toward the A31 Hog's Back.
    centreline: [
      { lat: 51.2758, lon: -0.7763 }, // EGLF
      { lat: 51.2655, lon: -0.789 }, // climb ahead on ~240°
      { lat: 51.2451, lon: -0.7985 }, // turning left onto ~220°
      { lat: 51.2208, lon: -0.806 }, // toward the A31 / Hog's Back
      { lat: 51.198, lon: -0.811 }, // over the Hog's Back ridge (design ≥ 4,000 ft)
    ],
    toleranceNm: 1.5,
    designAltitudeFt: 4000,
    note: 'Indicative only. Aircraft legitimately on approach/departure can sit below this — review before complaining.',
  },
]

/**
 * Controlled-airspace floors over the user's home area (Lower Bourne), AMSL feet.
 * Context for altitude rules; not a corridor centreline.
 */
export const HOME_AREA_CTA = {
  label: 'CTA over Lower Bourne',
  cta1FloorFt: 2000,
  cta1CeilingFt: 2500,
  cta4FloorFt: 2500,
  cta4CeilingFt: 3500,
  note: 'Controlled-airspace floor over Lower Bourne ≈ 2,000–2,500 ft AMSL. Context only.',
}
