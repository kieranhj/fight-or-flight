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

type SizeCat = 'A1' | 'A2' | 'A3' | 'A4' | 'A5' | 'A6'

/**
 * Trajectory heuristic for Farnborough (src/lib/trajectory.ts). Business jets come
 * back route-less from the crowd-sourced route DB, so we infer arriving/departing
 * Farnborough from the aircraft's motion plus alignment with the real published
 * WebTrak corridor swaths. All INDICATIVE — route-confirmed always wins.
 *
 * Corridor alignment (point-in-polygon against the EGLF arrival/departure swaths)
 * is REQUIRED to fire: it is the only signal that distinguishes a Farnborough
 * movement from a Heathrow/Gatwick one passing nearby (EGLL is ~12 nm away). A
 * confirming motion/heading signal on top of that meets the score threshold.
 */
export const TRAJECTORY_THRESHOLDS = {
  /** Descending faster than this (fpm, negative) counts as "descending". */
  descentRateFpm: -300,
  /** Climbing faster than this (fpm) counts as "climbing". */
  climbRateFpm: 500,
  /** Arrival funnel: only consider flights within this range / below this alt. */
  arrivalMaxDistanceNm: 30,
  arrivalMaxAltFt: 12_000,
  /** Departure funnel: tighter — climb-outs are near and low. */
  departureMaxDistanceNm: 12,
  departureMaxAltFt: 8_000,
  /** Track within this many degrees of (toward/away from) the field counts. */
  headingToleranceDeg: 40,
  /** Selected altitude (navAltitudeFt) at/below this suggests being vectored down. */
  selectedAltLowFt: 5_000,
  /** Evidence weights; corridor alignment is highest as the key discriminator. */
  score: { corridor: 3, descent: 2, climb: 2, heading: 2, selectedAltLow: 1 },
  /** Minimum score to tag (corridor=3 plus one confirming signal). */
  arrivalScoreThreshold: 5,
  departureScoreThreshold: 5,
}

/**
 * The ADS-B size-category BAND each airport realistically handles in normal ops,
 * used to keep proximity matches off the wrong airport. Two adjacent fields drive
 * the bands here: Farnborough (biz aviation) and Blackbushe (light GA), ~2.5 nm
 * apart — so size is what separates their traffic when position alone is ambiguous.
 *  - EGLF Farnborough: A2–A3. Business jets; NOT light GA (A1 → Blackbushe) and NOT
 *    A4/A5/A6 heavies/high-performance (→ Heathrow/Gatwick passing overhead).
 *  - EGLK Blackbushe: up to A2. Light aircraft, flying schools, gliders and light
 *    business jets; the only nearby field that accepts A1, so light traffic near
 *    Farnborough is attributed here rather than false-positiving Farnborough.
 *  - EGLL/EGKK: up to A5 (everything heavy).
 */
export const AIRPORT_SIZE_RANGE: Record<Airport['icao'], { min?: SizeCat; max: SizeCat }> = {
  EGLF: { min: 'A2', max: 'A3' },
  EGLK: { max: 'A2' },
  EGLL: { max: 'A5' },
  EGKK: { max: 'A5' },
}

// Fixed-wing size ordering. A6 (high-performance) ranks above A5 here so it's
// excluded from Farnborough. A7 (rotorcraft) and unknown have no size rank and
// are never excluded (helicopters operate at both Farnborough and Blackbushe).
const SIZE_RANK: Record<string, number> = { A1: 1, A2: 2, A3: 3, A4: 4, A5: 5, A6: 6 }

/** Could an aircraft of this ADS-B category plausibly operate at this airport? */
export function categoryFitsAirport(
  category: string | null,
  icao: Airport['icao'],
): boolean {
  const rank = category ? SIZE_RANK[category.toUpperCase()] : undefined
  if (rank == null) return true // unknown category or rotorcraft — don't exclude
  const band = AIRPORT_SIZE_RANGE[icao]
  const min = band.min ? SIZE_RANK[band.min] : 1
  return rank >= min && rank <= SIZE_RANK[band.max]
}

/**
 * Max-bound-only size check (ignores the band's lower bound). Used by the
 * trajectory detector: corridor alignment is decisive evidence of a movement, so a
 * SMALL or unknown category must not veto it (ADS-B category is often wrong/missing
 * for biz jets, and a light aircraft flying a Farnborough SID/STAR is a Farnborough
 * movement, not Blackbushe). We still exclude aircraft too LARGE for the airport.
 */
export function categoryNotTooLargeForAirport(
  category: string | null,
  icao: Airport['icao'],
): boolean {
  const rank = category ? SIZE_RANK[category.toUpperCase()] : undefined
  if (rank == null) return true
  return rank <= SIZE_RANK[AIRPORT_SIZE_RANGE[icao].max]
}

/**
 * Optional callsign-prefix → airport hints (weakest signal; indicative).
 * Left empty on purpose: callsign prefixes identify the *operator*, not the
 * airport, so we only add a mapping when we're confident a prefix is a reliable
 * tell for one of our airports. Empty = no guessing.
 */
export const CALLSIGN_AIRPORT_HINTS: { prefix: string; airport: Airport['icao'] }[] = []
