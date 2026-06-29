import type { NormalizedFlight } from './adsb'

// A coarse aircraft class for at-a-glance tagging, derived from the military flag
// and the ADS-B emitter category (A1–A7). Indicative — category isn't always
// broadcast. The size tiers follow the category weight bands but use intuitive
// labels: A3 (34–136 t) spans large biz jets and narrowbody airliners, so it
// reads as "medium"; A4 (B757-class) is "large"; A5 (widebodies) is "heavy".

// Light GA frequently broadcasts no emitter category. When category is unknown but
// the aircraft is very low and not fast, it's far more likely a piston/training
// aircraft than an airliner (which would be higher/faster or broadcasting a
// category), so display it as light rather than a full-size plane. Display-only and
// indicative; does not affect classification.
const UNKNOWN_LIGHT_MAX_ALT_FT = 5_000
const UNKNOWN_LIGHT_MAX_SPEED_KT = 180

export type AircraftKind =
  | 'military'
  | 'helicopter'
  | 'light'
  | 'small-jet'
  | 'medium-jet'
  | 'large-jet'
  | 'heavy-jet'
  | 'fast-jet'
  | 'other'

export function aircraftKind(f: NormalizedFlight): AircraftKind {
  if (f.military) return 'military'
  switch (f.category?.toUpperCase()) {
    case 'A7':
      return 'helicopter'
    case 'A1':
      return 'light'
    case 'A2':
      return 'small-jet'
    case 'A3':
      return 'medium-jet' // large biz jets (G650/Global) ↔ narrowbody airliners (A320/737)
    case 'A4':
      return 'large-jet' // high-vortex large, e.g. B757
    case 'A5':
      return 'heavy-jet' // widebodies, e.g. B777/A350/B747
    case 'A6':
      return 'fast-jet' // high-performance (>5g, >400 kt)
    default: {
      // Unknown category: treat very-low, not-fast traffic as light (likely GA).
      const low = f.altBaroFt != null && f.altBaroFt <= UNKNOWN_LIGHT_MAX_ALT_FT
      const notFast = f.groundSpeedKt == null || f.groundSpeedKt <= UNKNOWN_LIGHT_MAX_SPEED_KT
      return low && notFast ? 'light' : 'other'
    }
  }
}

export const KIND_LABEL: Record<AircraftKind, string> = {
  military: 'Military',
  helicopter: 'Helicopter',
  light: 'Light aircraft',
  'small-jet': 'Small jet',
  'medium-jet': 'Medium jet',
  'large-jet': 'Large jet',
  'heavy-jet': 'Heavy jet',
  'fast-jet': 'Fast jet',
  other: 'Aircraft',
}
