import type { NormalizedFlight } from './adsb'
import type { AltUnit, DistUnit, SpeedUnit } from './settings'

// Display formatters for telemetry. Pure functions, no UI deps. Unit params
// default to aviation-standard ft / nm / kt; pass the user's setting to convert.

const DASH = '—'

const FT_TO_M = 0.3048
const NM_TO_KM = 1.852
const KT_TO_KMH = 1.852

export function flightTitle(f: NormalizedFlight): string {
  return f.callsign ?? f.registration ?? (f.hex ? f.hex.toUpperCase() : 'Unknown')
}

export function formatAltitude(f: NormalizedFlight, unit: AltUnit = 'ft'): string {
  if (f.onGround) return 'On ground'
  if (f.altBaroFt == null) return DASH
  return unit === 'm'
    ? `${Math.round(f.altBaroFt * FT_TO_M).toLocaleString()} m`
    : `${f.altBaroFt.toLocaleString()} ft`
}

export function formatAltitudeFt(ft: number | null, unit: AltUnit = 'ft'): string {
  if (ft == null) return DASH
  return unit === 'm'
    ? `${Math.round(ft * FT_TO_M).toLocaleString()} m`
    : `${ft.toLocaleString()} ft`
}

export function formatSpeed(kt: number | null, unit: SpeedUnit = 'kt'): string {
  if (kt == null) return DASH
  return unit === 'kmh' ? `${Math.round(kt * KT_TO_KMH)} km/h` : `${Math.round(kt)} kt`
}

export type VerticalRate = { text: string; dir: 'up' | 'down' | 'level' | 'none' }

export function formatVerticalRate(fpm: number | null): VerticalRate {
  if (fpm == null) return { text: DASH, dir: 'none' }
  if (Math.abs(fpm) < 100) return { text: 'Level', dir: 'level' }
  const sign = fpm > 0 ? '+' : ''
  return { text: `${sign}${fpm.toLocaleString()} fpm`, dir: fpm > 0 ? 'up' : 'down' }
}

export function formatDistance(nm: number | null, unit: DistUnit = 'nm'): string {
  if (nm == null) return DASH
  return unit === 'km' ? `${(nm * NM_TO_KM).toFixed(1)} km` : `${nm.toFixed(1)} nm`
}

const COMPASS_16 = [
  'N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE',
  'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW',
]

/** Bearing in degrees → "218° SW" style label. */
export function formatBearing(deg: number | null): string {
  if (deg == null) return DASH
  const norm = ((deg % 360) + 360) % 360
  const point = COMPASS_16[Math.round(norm / 22.5) % 16]
  return `${Math.round(norm)}° ${point}`
}

/** "type · registration" subtitle, omitting whichever is missing. */
export function flightSubtitle(f: NormalizedFlight): string {
  return [f.type, f.registration].filter(Boolean).join(' · ') || DASH
}

export function formatClock(epochMs: number): string {
  return new Date(epochMs).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}
