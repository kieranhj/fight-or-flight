import type { NormalizedFlight } from './adsb'
import type { Incident } from './log'

// Parse an exported incident-log CSV back into records for review. Header-based,
// so it tolerates old logs (missing the newer telemetry columns) and any column
// order. Missing values become null.

export type ReviewRecord = {
  id: string
  loggedAt: number | null
  observedAt: number | null
  callsign: string | null
  registration: string | null
  type: string | null
  hex: string | null
  airportName: string | null
  altitudeFt: number | null
  distanceNm: number | null
  bearingDeg: number | null
  lat: number | null
  lon: number | null
  trackDeg: number | null
  category: string | null
  groundSpeedKt: number | null
  verticalRateFpm: number | null
  navAltitudeFt: number | null
  originIcao: string | null
  destinationIcao: string | null
  military: boolean | null
  /** Flags as recorded at capture time (free text). */
  flagsText: string | null
}

/** Split one CSV line into cells, honouring quotes and escaped quotes. */
function parseLine(line: string): string[] {
  const cells: string[] = []
  let cur = ''
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (inQuotes) {
      if (c === '"') {
        if (line[i + 1] === '"') {
          cur += '"'
          i++
        } else inQuotes = false
      } else cur += c
    } else if (c === '"') inQuotes = true
    else if (c === ',') {
      cells.push(cur)
      cur = ''
    } else cur += c
  }
  cells.push(cur)
  return cells
}

function num(v: string | undefined): number | null {
  if (v == null || v.trim() === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}
function str(v: string | undefined): string | null {
  if (v == null) return null
  const t = v.trim()
  return t.length > 0 ? t : null
}
function ms(v: string | undefined): number | null {
  if (v == null || v.trim() === '') return null
  const t = Date.parse(v)
  return Number.isFinite(t) ? t : null
}

export function parseIncidentCsv(text: string): ReviewRecord[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0)
  if (lines.length < 2) return []
  const headers = parseLine(lines[0]).map((h) => h.trim().toLowerCase())
  const col = (name: string) => headers.indexOf(name)
  const idx = {
    loggedAt: col('logged_at'),
    observedAt: col('observed_at'),
    callsign: col('callsign'),
    registration: col('registration'),
    type: col('type'),
    hex: col('hex'),
    airport: col('airport'),
    altitude: col('altitude_ft'),
    distance: col('distance_nm'),
    bearing: col('bearing_deg'),
    lat: col('lat'),
    lon: col('lon'),
    track: col('track_deg'),
    category: col('category'),
    gs: col('ground_speed_kt'),
    vs: col('vertical_rate_fpm'),
    nav: col('nav_altitude_ft'),
    origin: col('origin_icao'),
    destination: col('destination_icao'),
    military: col('military'),
    flags: col('flags'),
  }
  const at = (cells: string[], i: number) => (i >= 0 ? cells[i] : undefined)

  return lines.slice(1).map((line, i) => {
    const c = parseLine(line)
    const mil = str(at(c, idx.military))?.toLowerCase()
    return {
      id: `row-${i}`,
      loggedAt: ms(at(c, idx.loggedAt)),
      observedAt: ms(at(c, idx.observedAt)),
      callsign: str(at(c, idx.callsign)),
      registration: str(at(c, idx.registration)),
      type: str(at(c, idx.type)),
      hex: str(at(c, idx.hex)),
      airportName: str(at(c, idx.airport)),
      altitudeFt: num(at(c, idx.altitude)),
      distanceNm: num(at(c, idx.distance)),
      bearingDeg: num(at(c, idx.bearing)),
      lat: num(at(c, idx.lat)),
      lon: num(at(c, idx.lon)),
      trackDeg: num(at(c, idx.track)),
      category: str(at(c, idx.category)),
      groundSpeedKt: num(at(c, idx.gs)),
      verticalRateFpm: num(at(c, idx.vs)),
      navAltitudeFt: num(at(c, idx.nav)),
      originIcao: str(at(c, idx.origin)),
      destinationIcao: str(at(c, idx.destination)),
      military: mil == null ? null : mil === 'true' || mil === '1' || mil === 'yes',
      flagsText: str(at(c, idx.flags)),
    }
  })
}

/** A saved incident (our own log) → the same review record shape. */
export function incidentToRecord(i: Incident): ReviewRecord {
  return {
    id: i.id,
    loggedAt: i.loggedAt,
    observedAt: i.observedAt,
    callsign: i.callsign,
    registration: i.registration,
    type: i.type,
    hex: i.hex,
    airportName: i.airportName,
    altitudeFt: i.altitudeFt,
    distanceNm: i.distanceNm,
    bearingDeg: i.bearingDeg,
    lat: i.lat,
    lon: i.lon,
    trackDeg: i.trackDeg,
    category: i.category,
    groundSpeedKt: i.groundSpeedKt,
    verticalRateFpm: i.verticalRateFpm,
    navAltitudeFt: i.navAltitudeFt,
    originIcao: i.originIcao,
    destinationIcao: i.destinationIcao,
    military: i.military,
    flagsText: i.flags.map((f) => `${f.short} (${f.severity})`).join('; ') || null,
  }
}

/** Reconstruct a NormalizedFlight from a review record so the heuristics can re-run. */
export function recordToFlight(r: ReviewRecord): NormalizedFlight {
  const route =
    r.originIcao || r.destinationIcao
      ? {
          originIcao: r.originIcao,
          destinationIcao: r.destinationIcao,
          originLabel: r.originIcao,
          destinationLabel: r.destinationIcao,
        }
      : null
  return {
    hex: r.hex ?? '',
    callsign: r.callsign,
    registration: r.registration,
    type: r.type,
    category: r.category,
    altBaroFt: r.altitudeFt,
    altGeomFt: null,
    groundSpeedKt: r.groundSpeedKt,
    track: r.trackDeg,
    verticalRateFpm: r.verticalRateFpm,
    navAltitudeFt: r.navAltitudeFt,
    lat: r.lat,
    lon: r.lon,
    squawk: null,
    distanceNm: r.distanceNm,
    bearingDeg: r.bearingDeg,
    onGround: false,
    military: r.military ?? false,
    route,
  }
}
