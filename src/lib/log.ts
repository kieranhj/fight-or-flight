import type { NormalizedFlight } from './adsb'
import type { Assessment } from './assess'
import { AIRPORTS } from './../config/airports'

// localStorage incident log — your evidence base. Each logged complaint snapshots
// the flight + flags at the moment of reporting. Exportable to CSV.

export type LoggedFlag = { short: string; severity: string; reason: string }

export type Incident = {
  id: string
  loggedAt: number // epoch ms
  observedAt: number // feed timestamp at capture
  callsign: string | null
  registration: string | null
  type: string | null
  hex: string | null
  airportIcao: string | null
  airportName: string | null
  altitudeFt: number | null
  distanceNm: number | null
  bearingDeg: number | null
  lat: number | null
  lon: number | null
  flags: LoggedFlag[]
}

const KEY = 'foaf.incidents'

function read(): Incident[] {
  try {
    const raw = localStorage.getItem(KEY)
    return raw ? (JSON.parse(raw) as Incident[]) : []
  } catch {
    return []
  }
}

function write(list: Incident[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(list))
  } catch {
    /* ignore quota / disabled storage */
  }
}

/** Newest first. */
export function getIncidents(): Incident[] {
  return read().sort((a, b) => b.loggedAt - a.loggedAt)
}

export function incidentCount(): number {
  return read().length
}

export function removeIncident(id: string): void {
  write(read().filter((i) => i.id !== id))
}

export function clearIncidents(): void {
  write([])
}

function newId(): string {
  try {
    return crypto.randomUUID()
  } catch {
    return `${read().length}-${performance.now()}`
  }
}

/** Build an incident snapshot from a flight + its assessment. */
export function incidentFromFlight(
  flight: NormalizedFlight,
  assessment: Assessment,
  observedAt: number,
  loggedAt: number,
): Incident {
  const icao = assessment.classification.airport
  return {
    id: newId(),
    loggedAt,
    observedAt,
    callsign: flight.callsign,
    registration: flight.registration,
    type: flight.type,
    hex: flight.hex || null,
    airportIcao: icao,
    airportName: icao ? AIRPORTS[icao].name : assessment.classification.label,
    altitudeFt: flight.altBaroFt,
    distanceNm: flight.distanceNm,
    bearingDeg: flight.bearingDeg,
    lat: flight.lat,
    lon: flight.lon,
    flags: assessment.flags.map((f) => ({ short: f.short, severity: f.severity, reason: f.reason })),
  }
}

/** Append an incident; returns it. */
export function addIncident(incident: Incident): Incident {
  const list = read()
  list.push(incident)
  write(list)
  return incident
}

function csvCell(v: string | number | null): string {
  const s = v == null ? '' : String(v)
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

const CSV_HEADERS = [
  'logged_at',
  'observed_at',
  'callsign',
  'registration',
  'type',
  'hex',
  'airport',
  'altitude_ft',
  'distance_nm',
  'bearing_deg',
  'lat',
  'lon',
  'flags',
]

export function incidentsToCsv(): string {
  const rows = getIncidents().map((i) =>
    [
      new Date(i.loggedAt).toISOString(),
      new Date(i.observedAt).toISOString(),
      i.callsign,
      i.registration,
      i.type,
      i.hex,
      i.airportName,
      i.altitudeFt,
      i.distanceNm,
      i.bearingDeg,
      i.lat,
      i.lon,
      i.flags.map((f) => `${f.short} (${f.severity})`).join('; '),
    ]
      .map(csvCell)
      .join(','),
  )
  return [CSV_HEADERS.join(','), ...rows].join('\n')
}
