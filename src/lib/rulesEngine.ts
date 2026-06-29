import type { NormalizedFlight } from './adsb'
import type { Classification } from './classify'
import type { Airport, LatLon } from '../config/types'
import type { RuleSeverity } from '../config/rules'
import { AIRPORTS } from '../config/airports'
import { CORRIDORS } from '../config/corridors'
import { RULE_THRESHOLDS } from '../config/rules'
import { UK_BANK_HOLIDAYS } from '../config/calendar'
import { haversineNm, pointInPolygon } from './geo'

// Rules engine (Build Plan §8). Each rule is a small typed object; the engine runs
// the applicable ones over a flight and returns the triggered flags. Adding/refining
// accuracy = adding/replacing rule objects — the UI never changes. All thresholds
// come from config/, never inlined here.

export type Flag = {
  ruleId: string
  severity: RuleSeverity
  /** Short badge text, e.g. "Out of hours". */
  short: string
  /** One-line explanation. */
  reason: string
}

export type RuleContext = {
  now: Date
  classification: Classification
  owningAirport: Airport | null
  userPos: LatLon | null
}

type EvalResult = { triggered: boolean; severity?: RuleSeverity; short?: string; reason?: string }

type Rule = {
  id: string
  severity: RuleSeverity
  appliesTo(flight: NormalizedFlight, ctx: RuleContext): boolean
  evaluate(flight: NormalizedFlight, ctx: RuleContext): EvalResult
}

// ── Time helpers (UK local, handling GMT/BST automatically) ──────────────────
type UkClock = { minutes: number; weekday: string; isoDate: string }

function ukClock(now: Date): UkClock {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London',
    hour12: false,
    weekday: 'short',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(now)
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? ''
  let hour = parseInt(get('hour'), 10)
  if (hour === 24) hour = 0 // some engines render midnight as 24
  const minute = parseInt(get('minute'), 10)
  return {
    minutes: hour * 60 + minute,
    weekday: get('weekday'),
    isoDate: `${get('year')}-${get('month')}-${get('day')}`,
  }
}

function parseHHMM(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number)
  return h * 60 + m
}

function hhmm(minutes: number): string {
  const h = Math.floor(minutes / 60) % 24
  const m = minutes % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

/** True if `minutes` falls in [open, close), handling windows that wrap midnight. */
function inWindowWrap(minutes: number, open: number, close: number): boolean {
  return open <= close ? minutes >= open && minutes < close : minutes >= open || minutes < close
}

const DAY_LABEL: Record<string, string> = {
  weekday: 'weekday',
  weekend: 'weekend',
  bankHoliday: 'bank holiday',
}

// ── R1 Operating hours (deterministic) ───────────────────────────────────────
const r1Hours: Rule = {
  id: 'R1-hours',
  severity: 'breach',
  appliesTo: (_f, ctx) => ctx.owningAirport != null,
  evaluate: (_f, ctx) => {
    const airport = ctx.owningAirport!
    const clock = ukClock(ctx.now)
    const hours = airport.hours

    // Heathrow/Gatwick: night quota period is restricted, not banned → info.
    if (hours.nightRestricted) {
      const open = parseHHMM(hours.nightRestricted.open)
      const close = parseHHMM(hours.nightRestricted.close)
      if (inWindowWrap(clock.minutes, open, close)) {
        return {
          triggered: true,
          severity: 'info',
          short: 'Night period',
          reason: `${airport.name} movement at ${hhmm(clock.minutes)} UK — within the ${hours.nightRestricted.open}–${hours.nightRestricted.close} night quota period (restricted, not banned).`,
        }
      }
    }

    // Otherwise compare against the permitted window for the day type.
    const isBankHoliday = UK_BANK_HOLIDAYS.has(clock.isoDate)
    const isWeekend = clock.weekday === 'Sat' || clock.weekday === 'Sun'
    const dayType = isBankHoliday ? 'bankHoliday' : isWeekend ? 'weekend' : 'weekday'
    const win = hours[dayType]
    const open = parseHHMM(win.open)
    const close = parseHHMM(win.close)
    const grace = RULE_THRESHOLDS.hoursGraceMinutes

    // All permitted windows here are non-wrapping; closed airports (00:00–24:00)
    // never trip this. Grace widens the permitted band slightly at each edge.
    const outside = clock.minutes < open - grace || clock.minutes >= close + grace
    if (outside) {
      return {
        triggered: true,
        severity: 'breach',
        short: 'Out of hours',
        reason: `${airport.name} movement at ${hhmm(clock.minutes)} UK on a ${DAY_LABEL[dayType]} — outside permitted hours (${win.open}–${win.close}). Likely breach.`,
      }
    }
    return { triggered: false }
  },
}

// ── R2 Altitude floor (indicative, Farnborough) ──────────────────────────────
// The WebTrak Departures/Arrivals zones carry the published expected altitude
// band AT THEIR LOCATION (minAltFt set). A flight inside such a zone but below its
// band floor is unusually low for where it is — a location-aware floor that beats
// a single design altitude. The lateral "Corridors" swaths have no band (skipped).
const EGLF_ALT_ZONES = CORRIDORS.filter((c) => c.airport === 'EGLF' && c.minAltFt != null)

const r2Altitude: Rule = {
  id: 'R2-altitude',
  severity: 'indicative',
  appliesTo: (f, ctx) =>
    ctx.owningAirport?.icao === 'EGLF' && f.altBaroFt != null && f.lat != null && f.lon != null,
  evaluate: (f) => {
    const pos = { lat: f.lat!, lon: f.lon! }
    // Among the altitude-banded zones the flight is inside, use the most lenient
    // floor (lowest minAltFt) to stay conservative — flag only when clearly low.
    let floor: number | null = null
    let zoneLabel = ''
    for (const z of EGLF_ALT_ZONES) {
      if (!pointInPolygon(pos, z.polygon)) continue
      if (floor == null || z.minAltFt! < floor) {
        floor = z.minAltFt!
        zoneLabel = z.label
      }
    }
    if (floor == null) return { triggered: false }
    if (f.altBaroFt! < floor - RULE_THRESHOLDS.altitudeFloorMarginFt) {
      return {
        triggered: true,
        severity: 'indicative',
        short: 'Below profile',
        reason: `${f.altBaroFt!.toLocaleString()} ft — below the expected ${floor.toLocaleString()} ft+ here ("${zoneLabel}"). Indicative; aircraft on approach are legitimately low.`,
      }
    }
    return { triggered: false }
  },
}

// ── R3 Corridor proximity (indicative) ───────────────────────────────────────
// The published swaths (the tight SID/STAR "Corridors" plus the broader
// Departures/Arrivals probability zones) together cover everywhere Farnborough
// traffic is expected. An EGLF flight in the terminal area inside NONE of them is
// off any designated route. Testing the union (not just the lateral corridors)
// avoids false positives near the field, where the tight swaths leave gaps.
// Point-in-polygon, so no tolerance tuning needed.
const EGLF_CORRIDORS = CORRIDORS.filter((c) => c.airport === 'EGLF')

const r3Corridor: Rule = {
  id: 'R3-corridor',
  severity: 'indicative',
  appliesTo: (f, ctx) =>
    ctx.owningAirport?.icao === 'EGLF' &&
    f.lat != null &&
    f.lon != null &&
    EGLF_CORRIDORS.length > 0,
  evaluate: (f, ctx) => {
    const airport = ctx.owningAirport!
    const pos = { lat: f.lat!, lon: f.lon! }
    // Only meaningful in the terminal area; far out, a flight is legitimately not
    // yet on (or already off) a SID/STAR and "off track" would be noise.
    const dNm = haversineNm(pos, airport.position)
    if (dNm > RULE_THRESHOLDS.corridorCheckMaxDistanceNm) return { triggered: false }
    if (EGLF_CORRIDORS.some((c) => pointInPolygon(pos, c.polygon))) {
      return { triggered: false }
    }
    return {
      triggered: true,
      severity: 'indicative',
      short: 'Off track',
      reason: `${dNm.toFixed(1)} nm from Farnborough but outside every published departure/arrival corridor swath. Indicative; review before acting.`,
    }
  },
}

const RULES: Rule[] = [r1Hours, r2Altitude, r3Corridor]

/** Run all applicable rules over a flight and return the triggered flags. */
export function runRules(flight: NormalizedFlight, ctx: RuleContext): Flag[] {
  const flags: Flag[] = []
  for (const rule of RULES) {
    if (!rule.appliesTo(flight, ctx)) continue
    const r = rule.evaluate(flight, ctx)
    if (r.triggered) {
      flags.push({
        ruleId: rule.id,
        severity: r.severity ?? rule.severity,
        short: r.short ?? rule.id,
        reason: r.reason ?? '',
      })
    }
  }
  return flags
}

/** Build a rule context from a flight's classification. */
export function buildContext(
  classification: Classification,
  now: Date,
  userPos: LatLon | null = null,
): RuleContext {
  return {
    now,
    classification,
    owningAirport: classification.airport ? AIRPORTS[classification.airport] : null,
    userPos,
  }
}
