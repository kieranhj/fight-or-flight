import type { NormalizedFlight } from './adsb'

// A coarse aircraft class for at-a-glance tagging, derived from the military flag
// and the ADS-B emitter category (A1–A7). Indicative — category isn't always
// broadcast, and "small/large jet" is an approximation from the category band.
export type AircraftKind =
  | 'military'
  | 'helicopter'
  | 'light'
  | 'small-jet'
  | 'large-jet'
  | 'other'

export function aircraftKind(f: NormalizedFlight): AircraftKind {
  if (f.military) return 'military'
  switch (f.category?.toUpperCase()) {
    case 'A7':
      return 'helicopter'
    case 'A1':
      return 'light'
    case 'A2':
    case 'A6': // small / high-performance
      return 'small-jet'
    case 'A3':
    case 'A4':
    case 'A5': // large / heavy
      return 'large-jet'
    default:
      return 'other'
  }
}

export const KIND_LABEL: Record<AircraftKind, string> = {
  military: 'Military',
  helicopter: 'Helicopter',
  light: 'Light aircraft',
  'small-jet': 'Small jet',
  'large-jet': 'Large jet',
  other: 'Aircraft',
}
