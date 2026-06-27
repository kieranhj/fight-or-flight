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
 * Optional callsign-prefix → airport hints (weakest signal; indicative).
 * Left empty on purpose: callsign prefixes identify the *operator*, not the
 * airport, so we only add a mapping when we're confident a prefix is a reliable
 * tell for one of our airports. Empty = no guessing.
 */
export const CALLSIGN_AIRPORT_HINTS: { prefix: string; airport: Airport['icao'] }[] = []
