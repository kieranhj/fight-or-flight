import { NEARBY_DEFAULTS } from '../config/api'
import { HOME_LOCATION } from '../config/airports'
import type { FlightGroup } from './classify'
import type { CorridorKind } from '../config/corridors'

// User-configurable settings (Phase 6), persisted to localStorage. Defaults come
// from config so the seed values stay in one place.

export type AltUnit = 'ft' | 'm'
export type DistUnit = 'nm' | 'km'
export type SpeedUnit = 'kt' | 'kmh'
export type Units = { alt: AltUnit; dist: DistUnit; speed: SpeedUnit }

export type LocationMode = 'gps' | 'home'

/** Opt-ins to show normally-filtered traffic (all default off). */
export type IncludeFilters = { military: boolean; rotorcraft: boolean; light: boolean }

/** Which classification groups to show (all default on). Keyed by FlightGroup
 * (the three airport ICAOs plus transit / overflight / unknown). */
export type ShowGroups = Record<FlightGroup, boolean>

/** Which corridor overlays to draw, by kind (both default on). */
export type ShowCorridors = Record<CorridorKind, boolean>

export type Settings = {
  /** Number of aircraft to show. */
  n: number
  /** Search radius in nautical miles. */
  radiusNm: number
  units: Units
  /** 'gps' uses device location; 'home' always uses the home coordinates below. */
  locationMode: LocationMode
  /** When GPS fails, fall back to the home coordinates instead of erroring. */
  homeFallback: boolean
  homeLat: number
  homeLon: number
  /** Include categories normally filtered out (military / helicopters / light GA). */
  include: IncludeFilters
  /** Show/hide flights by classification group. */
  showGroups: ShowGroups
  /** Draw the airport corridor overlays on the map, by kind. */
  showCorridors: ShowCorridors
  /** Re-frame the map to fit all aircraft on every refresh. Off = stays put after
   * the initial fit, preserving the user's pan/zoom. */
  recenterOnRefresh: boolean
  /** Re-fetch automatically while results are shown (paused when hidden/offline). */
  autoRefresh: boolean
  /** Auto-refresh interval in seconds. */
  autoRefreshSec: number
}

export const DEFAULT_SETTINGS: Settings = {
  n: NEARBY_DEFAULTS.n,
  radiusNm: NEARBY_DEFAULTS.radiusNm,
  units: { alt: 'ft', dist: 'nm', speed: 'kt' },
  locationMode: 'gps',
  homeFallback: true,
  homeLat: HOME_LOCATION.lat,
  homeLon: HOME_LOCATION.lon,
  include: { military: false, rotorcraft: false, light: false },
  showGroups: { EGLF: true, EGLL: true, EGKK: true, transit: true, overflight: true, unknown: true },
  showCorridors: { departure: true, arrival: true },
  recenterOnRefresh: true,
  autoRefresh: false,
  autoRefreshSec: 10,
}

const KEY = 'foaf.settings'

function clamp(n: number, lo: number, hi: number, fallback: number): number {
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : fallback
}

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return DEFAULT_SETTINGS
    const parsed = JSON.parse(raw) as Partial<Settings>
    // Migration: showCorridors was once a single boolean (one overlay toggle).
    const rawCorridors = parsed.showCorridors as unknown
    const legacyCorridors =
      typeof rawCorridors === 'boolean'
        ? { departure: rawCorridors, arrival: rawCorridors }
        : parsed.showCorridors
    return {
      ...DEFAULT_SETTINGS,
      ...parsed,
      units: { ...DEFAULT_SETTINGS.units, ...parsed.units },
      include: { ...DEFAULT_SETTINGS.include, ...parsed.include },
      showGroups: { ...DEFAULT_SETTINGS.showGroups, ...parsed.showGroups },
      showCorridors: { ...DEFAULT_SETTINGS.showCorridors, ...legacyCorridors },
      n: clamp(parsed.n ?? DEFAULT_SETTINGS.n, 1, 20, DEFAULT_SETTINGS.n),
      radiusNm: clamp(parsed.radiusNm ?? DEFAULT_SETTINGS.radiusNm, 1, 50, DEFAULT_SETTINGS.radiusNm),
      autoRefreshSec: clamp(
        parsed.autoRefreshSec ?? DEFAULT_SETTINGS.autoRefreshSec,
        5,
        120,
        DEFAULT_SETTINGS.autoRefreshSec,
      ),
    }
  } catch {
    return DEFAULT_SETTINGS
  }
}

export function saveSettings(s: Settings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s))
  } catch {
    /* ignore */
  }
}
