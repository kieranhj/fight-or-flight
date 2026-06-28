import type { Airport } from './types'

// Thresholds for classify.ts (Build Plan §6 Phase 3). Kept here, not inline, so
// accuracy can be tuned without touching logic. All values are deliberately
// conservative — geometric matches are flagged INDICATIVE; only a route match to
// one of our airports is treated as confident.

export const CLASSIFY_THRESHOLDS = {
  /**
   * A flight low and within this many nm of an airport is treated as plausibly
   * arriving/departing there (terminal-area association). Indicative only.
   */
  terminalRadiusNm: 15,
  /**
   * Only apply terminal-area association below this barometric altitude (ft).
   * Above it, an aircraft near an airport is more likely an overflight.
   */
  terminalMaxAltFt: 10_000,
  /**
   * Above this altitude (ft) with no owning-airport route match, label the
   * flight a high-level transit/overflight rather than guessing an airport.
   */
  overflightAltFt: 18_000,
  /**
   * If the flight's track points within this many degrees of the bearing to the
   * airport it's heading toward (likely arrival); away from it => likely
   * departure. Used only to enrich the reason text, not to decide the airport.
   */
  headingToleranceDeg: 50,
}

/**
 * Largest ADS-B size category each airport realistically handles in normal ops.
 * Farnborough is business-aviation only: its biggest movements are large-cabin
 * biz jets / corporate airliners (Gulfstream G650, Global 7500, BBJ ≈ A3). It does
 * NOT take A4 (B757-class), A5 (heavies) or A6 (high-performance) — so such an
 * aircraft near Farnborough with no route is a Heathrow/Gatwick movement passing
 * overhead, not a Farnborough one. Heathrow/Gatwick take everything up to A5.
 */
export const AIRPORT_MAX_SIZE_CATEGORY: Record<Airport['icao'], 'A3' | 'A5'> = {
  EGLF: 'A3',
  EGLL: 'A5',
  EGKK: 'A5',
}

// Fixed-wing size ordering. A6 (high-performance) ranks above A5 here so it's
// excluded from Farnborough. A7 (rotorcraft) and unknown have no size rank and
// are never excluded (helicopters do operate at Farnborough).
const SIZE_RANK: Record<string, number> = { A1: 1, A2: 2, A3: 3, A4: 4, A5: 5, A6: 6 }

/** Could an aircraft of this ADS-B category plausibly operate at this airport? */
export function categoryFitsAirport(
  category: string | null,
  icao: Airport['icao'],
): boolean {
  const rank = category ? SIZE_RANK[category.toUpperCase()] : undefined
  if (rank == null) return true // unknown category or rotorcraft — don't exclude
  return rank <= SIZE_RANK[AIRPORT_MAX_SIZE_CATEGORY[icao]]
}

/**
 * Optional callsign-prefix → airport hints (weakest signal; indicative).
 * Left empty on purpose: callsign prefixes identify the *operator*, not the
 * airport, so we only add a mapping when we're confident a prefix is a reliable
 * tell for one of our airports. Empty = no guessing.
 */
export const CALLSIGN_AIRPORT_HINTS: { prefix: string; airport: Airport['icao'] }[] = []
