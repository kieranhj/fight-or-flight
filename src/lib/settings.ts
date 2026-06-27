import { NEARBY_DEFAULTS } from '../config/api'
import { HOME_LOCATION } from '../config/airports'

// User-configurable settings (Phase 6), persisted to localStorage. Defaults come
// from config so the seed values stay in one place.

export type AltUnit = 'ft' | 'm'
export type DistUnit = 'nm' | 'km'
export type SpeedUnit = 'kt' | 'kmh'
export type Units = { alt: AltUnit; dist: DistUnit; speed: SpeedUnit }

export type LocationMode = 'gps' | 'home'

/** Opt-ins to show normally-filtered traffic (all default off). */
export type IncludeFilters = { military: boolean; rotorcraft: boolean; light: boolean }

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
    return {
      ...DEFAULT_SETTINGS,
      ...parsed,
      units: { ...DEFAULT_SETTINGS.units, ...parsed.units },
      include: { ...DEFAULT_SETTINGS.include, ...parsed.include },
      n: clamp(parsed.n ?? DEFAULT_SETTINGS.n, 1, 20, DEFAULT_SETTINGS.n),
      radiusNm: clamp(parsed.radiusNm ?? DEFAULT_SETTINGS.radiusNm, 1, 50, DEFAULT_SETTINGS.radiusNm),
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
