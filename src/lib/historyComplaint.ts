import type { HistoryFlight, HistoryFlag } from './history'
import { FLAG_SHORT } from './history'
import type { NormalizedFlight } from './adsb'
import type { Flag } from './rulesEngine'
import type { LatLon } from '../config/types'
import { haversineNm, bearingDeg } from './geo'

// Turning a recorded (D1) flight into the shape the complaint generator wants.
// Shared by the "For Review" list and the recorded-flights sheet so a post-hoc
// complaint reads the same wherever it was raised from.

/** Badge/citation form of a stored flag. Stored reasons are cited VERBATIM —
 * a post-hoc complaint must say what was actually logged at the time, not what
 * re-running today's rules would conclude. */
export const toFlag = (f: HistoryFlag): Flag => ({
  ruleId: f.rule_id,
  severity: f.severity,
  short: FLAG_SHORT[f.rule_id] ?? f.rule_id,
  reason: f.reason,
})

/** The moment a complaint is about: the flag's evidence time where there is
 * one, else the landing/takeoff, else first seen. */
export function flagMoment(f: HistoryFlight): number {
  return f.flags.find((fl) => fl.ts != null)?.ts ?? f.landing_ts ?? f.takeoff_ts ?? f.first_ts
}

/** Rebuild a NormalizedFlight at the flag's moment from the D1 row. `home` is
 * the user's own vantage point from Settings (device-local; defaults to the
 * airport) — used only to phrase distance/bearing in the complaint text.
 *
 * Position comes from flag evidence, so an unflagged flight has none: the
 * letter then omits the position line rather than inventing one. Replay is the
 * route to a precise position for a flight the rules didn't flag. */
export function toComplaintFlight(f: HistoryFlight, home: LatLon): NormalizedFlight {
  const evid = f.flags.find((fl) => fl.lat != null && fl.lon != null) ?? null
  const lat = evid?.lat ?? null
  const lon = evid?.lon ?? null
  const pos = lat != null && lon != null ? { lat, lon } : null
  return {
    hex: f.hex,
    callsign: f.callsign,
    registration: f.reg,
    type: f.type,
    category: f.category,
    altBaroFt: evid?.alt_ft ?? f.min_alt_ft,
    altGeomFt: null,
    groundSpeedKt: null,
    track: null,
    verticalRateFpm: null,
    navAltitudeFt: null,
    lat,
    lon,
    squawk: null,
    distanceNm: pos ? Math.round(haversineNm(pos, home) * 10) / 10 : null,
    bearingDeg: pos ? Math.round(bearingDeg(home, pos)) : null,
    onGround: false,
    military: f.military === 1,
    route:
      f.origin_icao || f.destination_icao
        ? {
            originIcao: f.origin_icao,
            destinationIcao: f.destination_icao,
            originLabel: f.origin_label ?? f.origin_icao,
            destinationLabel: f.destination_label ?? f.destination_icao,
          }
        : null,
  }
}
