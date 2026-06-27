// Exclusion filters from Build Plan §7. v1 keeps fixed-wing jets (small → heavy)
// and drops military, rotorcraft and very light / hobbyist GA so the list shows
// the airliner/biz-jet traffic the complaint flow is about.

// ADS-B emitter categories (ADSBExchange-v2 `category`, A1–A7):
//   A1 light (<15.5k lb), A2 small, A3 large, A4 high-vortex large,
//   A5 heavy, A6 high-perf, A7 rotorcraft.
export const EXCLUDED_CATEGORIES = ['A1', 'A7'] as const

/** Keep these categories (small jet → heavy). Used as an allow-check alongside exclusions. */
export const KEPT_CATEGORIES = ['A2', 'A3', 'A4', 'A5', 'A6'] as const

/** Drop anything flagged military by the feed. */
export const EXCLUDE_MILITARY = true

/**
 * Drop aircraft reporting `alt_baro: "ground"` (parked/taxiing at an airport).
 * The app is about overhead noise, so on-ground traffic is just clutter.
 */
export const EXCLUDE_ON_GROUND = true

/**
 * Optional ICAO type-code exclusions for known light GA, in addition to the
 * category filter. Empty for now; populate as we observe noise from specific
 * light types. Matched case-insensitively against the `t` field.
 */
export const EXCLUDED_TYPE_CODES: string[] = []

export const FILTER_CONFIG = {
  excludedCategories: EXCLUDED_CATEGORIES,
  keptCategories: KEPT_CATEGORIES,
  excludeMilitary: EXCLUDE_MILITARY,
  excludeOnGround: EXCLUDE_ON_GROUND,
  excludedTypeCodes: EXCLUDED_TYPE_CODES,
}
