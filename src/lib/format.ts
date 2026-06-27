import type { NormalizedFlight } from './adsb'

// Display formatters for telemetry. Pure functions, no UI deps.

const DASH = '—'

export function flightTitle(f: NormalizedFlight): string {
  return f.callsign ?? f.registration ?? (f.hex ? f.hex.toUpperCase() : 'Unknown')
}

export function formatAltitude(f: NormalizedFlight): string {
  if (f.onGround) return 'On ground'
  if (f.altBaroFt == null) return DASH
  return `${f.altBaroFt.toLocaleString()} ft`
}

export function formatSpeed(kt: number | null): string {
  return kt == null ? DASH : `${Math.round(kt)} kt`
}

export type VerticalRate = { text: string; dir: 'up' | 'down' | 'level' | 'none' }

export function formatVerticalRate(fpm: number | null): VerticalRate {
  if (fpm == null) return { text: DASH, dir: 'none' }
  if (Math.abs(fpm) < 100) return { text: 'Level', dir: 'level' }
  const sign = fpm > 0 ? '+' : ''
  return { text: `${sign}${fpm.toLocaleString()} fpm`, dir: fpm > 0 ? 'up' : 'down' }
}

export function formatDistance(nm: number | null): string {
  return nm == null ? DASH : `${nm.toFixed(1)} nm`
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
