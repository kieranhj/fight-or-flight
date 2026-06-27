import type { NormalizedFlight } from './adsb'
import type { Classification } from './classify'
import type { Airport, LatLon } from '../config/types'
import type { RuleSeverity } from '../config/rules'
import { AIRPORTS } from '../config/airports'
import { CORRIDORS } from '../config/corridors'
import { RULE_THRESHOLDS } from '../config/rules'
import { UK_BANK_HOLIDAYS } from '../config/calendar'
import { haversineNm, distanceToPolylineNm } from './geo'

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
function farnboroughDesignFloorFt(): number | null {
  const c = CORRIDORS.find((c) => c.airport === 'EGLF' && c.designAltitudeFt != null)
  return c?.designAltitudeFt ?? null
}

const r2Altitude: Rule = {
  id: 'R2-altitude',
  severity: 'indicative',
  appliesTo: (f, ctx) =>
    ctx.owningAirport?.icao === 'EGLF' && f.altBaroFt != null && f.lat != null && f.lon != null,
  evaluate: (f, ctx) => {
    const floor = farnboroughDesignFloorFt()
    if (floor == null) return { triggered: false }
    const airport = ctx.owningAirport!
    const dNm = haversineNm({ lat: f.lat!, lon: f.lon! }, airport.position)
    if (dNm > RULE_THRESHOLDS.altitudeCheckMaxDistanceNm) return { triggered: false }
    if (f.altBaroFt! < floor - RULE_THRESHOLDS.altitudeFloorMarginFt) {
      return {
        triggered: true,
        severity: 'indicative',
        short: 'Below profile',
        reason: `${f.altBaroFt!.toLocaleString()} ft, ${dNm.toFixed(1)} nm from Farnborough — below the ~${floor.toLocaleString()} ft design profile over the Hog's Back. Indicative; aircraft on approach are legitimately low.`,
      }
    }
    return { triggered: false }
  },
}

// ── R3 Corridor proximity (indicative) ───────────────────────────────────────
const r3Corridor: Rule = {
  id: 'R3-corridor',
  severity: 'indicative',
  appliesTo: (f, ctx) =>
    ctx.owningAirport != null &&
    f.lat != null &&
    f.lon != null &&
    CORRIDORS.some((c) => c.airport === ctx.owningAirport!.icao),
  evaluate: (f, ctx) => {
    const airport = ctx.owningAirport!
    const pos = { lat: f.lat!, lon: f.lon! }
    // Only within the terminal area is "off track" meaningful.
    if (haversineNm(pos, airport.position) > RULE_THRESHOLDS.altitudeCheckMaxDistanceNm) {
      return { triggered: false }
    }
    const corridors = CORRIDORS.filter((c) => c.airport === airport.icao)
    let best: { offset: number; tol: number; label: string } | null = null
    for (const c of corridors) {
      const offset = distanceToPolylineNm(pos, c.centreline)
      const tol = c.toleranceNm ?? RULE_THRESHOLDS.corridorDefaultToleranceNm
      if (!best || offset < best.offset) best = { offset, tol, label: c.label }
    }
    if (!best) return { triggered: false }
    // Flag a moderate offset; beyond the upper bound it's a different route, not "off track".
    if (best.offset > best.tol && best.offset <= RULE_THRESHOLDS.corridorMaxOffsetNm) {
      return {
        triggered: true,
        severity: 'indicative',
        short: 'Off track',
        reason: `${best.offset.toFixed(1)} nm from the ${best.label} centreline (tolerance ${best.tol} nm). Indicative; only that SID is encoded as seed geometry.`,
      }
    }
    return { triggered: false }
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
