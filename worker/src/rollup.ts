import { AIRPORTS } from '../../src/config/airports'
import { CORRIDORS } from '../../src/config/corridors'
import { RULE_THRESHOLDS } from '../../src/config/rules'
import { UK_BANK_HOLIDAYS } from '../../src/config/calendar'
import { haversineNm, pointInPolygon } from '../../src/lib/geo'
import type { CaptureEnv } from './capture'

// Nightly rollup (docs/TELEMETRY-CAPTURE-PLAN.md, Phase H2): turn a day's raw
// capture (raw/YYYY/MM/DD.ndjson.gz) into queryable D1 rows —
//   flights        one row per flight session (gap > 10 min splits)
//   flight_flags   R1 hours / R2 altitude / R3 corridor, evaluated at logged times
//   daily_stats    per-day movement + breach counts
//
// EGLF/EGLK movements are GROUND-TRUTH where possible: the recorder keeps ground
// aircraft near those fields, so a session that starts/ends on the ground there
// is definitively a departure/arrival — no heuristics. When feed coverage misses
// the ground segment, a session that appears/disappears low over the field is
// classified by geometry (indicative). Rollup is idempotent per day (delete +
// re-insert) and makes no external network calls.

export interface HistoryEnv extends CaptureEnv {
  HISTORY?: D1Database
}

/** Route shape persisted per flight (subset of the proxy's FlightRoute). */
export type RouteLite = {
  originIcao: string | null
  destinationIcao: string | null
  originLabel: string | null
  destinationLabel: string | null
}

/** Injected by index.ts (lookupRoute lives there; injection avoids an import
 * cycle). Cached at the edge; null when the callsign is unknown. */
export type RouteLookupFn = (callsign: string) => Promise<RouteLite | null>

/** Max fresh route lookups per rollup (subrequest-budget guard; memoized per
 * callsign so repeat callsigns are free). */
const ROUTE_LOOKUP_CAP = 150

// ── Session thresholds ───────────────────────────────────────────────────────
const SESSION_GAP_S = 600 // >10 min without a sample = new session
/** Geometry fallback: a session endpoint this close & low over a field counts
 * as a takeoff/landing the feed's ground coverage missed. Per-field because
 * EGLF and EGLK are only ~3 nm apart. */
const ENDPOINT_NEAR = {
  EGLF: { nm: 4, altFt: 2500 },
  EGLK: { nm: 3, altFt: 2000 },
} as const
type MovementField = keyof typeof ENDPOINT_NEAR
const FIELDS: MovementField[] = ['EGLF', 'EGLK']

// R2/R3 sample prefilter: only evaluate near Farnborough and below this.
const RULE_MAX_ALT_FT = 10_000
const EGLF_POS = AIRPORTS.EGLF.position
const EGLF_ALT_ZONES = CORRIDORS.filter((c) => c.airport === 'EGLF' && c.minAltFt != null)
const EGLF_SWATHS = CORRIDORS.filter((c) => c.airport === 'EGLF')

// ── Capture record (mirror of capture.ts CaptureRecord) ──────────────────────
type Rec = {
  t: number
  i: string
  c?: string
  rg?: string
  ty?: string
  ct?: string
  la: number
  lo: number
  ab?: number
  gs?: number
  vr?: number
  g?: 1
  m?: 1
}

// ── Session accumulator ──────────────────────────────────────────────────────
type WorstSample = { t: number; la: number; lo: number; ab: number | null; value: number; label: string }

type Session = {
  hex: string
  callsign: string | null
  reg: string | null
  type: string | null
  category: string | null
  military: boolean
  firstTs: number
  lastTs: number
  samples: number
  first: Rec
  last: Rec
  minAltFt: number | null
  maxAltFt: number | null
  minDistHomeNm: number | null
  minDistEglfNm: number | null
  /** Ground contact near each field, before/after any airborne sample. */
  groundBefore: Partial<Record<MovementField, number>> // last ground ts before airborne
  groundAfter: Partial<Record<MovementField, number>> // first ground ts after airborne
  groundOnly: boolean
  firstAirborneTs: number | null
  lastAirborneTs: number | null
  /** Worst R2 sample (largest deficit below the zone floor). */
  r2: WorstSample | null
  /** Worst R3 sample (lowest altitude while off every swath, within the gate). */
  r3: WorstSample | null
}

const HOME = { lat: 51.188, lon: -0.802 } // mirrors capture.ts / HOME_LOCATION

function newSession(r: Rec): Session {
  return {
    hex: r.i,
    callsign: null,
    reg: null,
    type: null,
    category: null,
    military: false,
    firstTs: r.t,
    lastTs: r.t,
    samples: 0,
    first: r,
    last: r,
    minAltFt: null,
    maxAltFt: null,
    minDistHomeNm: null,
    minDistEglfNm: null,
    groundBefore: {},
    groundAfter: {},
    groundOnly: true,
    firstAirborneTs: null,
    lastAirborneTs: null,
    r2: null,
    r3: null,
  }
}

function addSample(s: Session, r: Rec): void {
  s.samples++
  s.lastTs = r.t
  s.last = r
  if (r.c) s.callsign = r.c
  if (r.rg) s.reg = r.rg
  if (r.ty) s.type = r.ty
  if (r.ct) s.category = r.ct
  if (r.m) s.military = true

  const pos = { lat: r.la, lon: r.lo }
  const dHome = haversineNm(pos, HOME)
  if (s.minDistHomeNm == null || dHome < s.minDistHomeNm) s.minDistHomeNm = dHome
  const dEglf = haversineNm(pos, EGLF_POS)
  if (s.minDistEglfNm == null || dEglf < s.minDistEglfNm) s.minDistEglfNm = dEglf

  if (r.g) {
    // Which field is this ground contact at? (Recorder only keeps near-field ground.)
    for (const f of FIELDS) {
      if (haversineNm(pos, AIRPORTS[f].position) <= 3) {
        if (s.firstAirborneTs == null) s.groundBefore[f] = r.t
        else if (s.groundAfter[f] == null) s.groundAfter[f] = r.t
        break
      }
    }
    return
  }

  s.groundOnly = false
  if (s.firstAirborneTs == null) s.firstAirborneTs = r.t
  s.lastAirborneTs = r.t
  if (r.ab != null) {
    if (s.minAltFt == null || r.ab < s.minAltFt) s.minAltFt = r.ab
    if (s.maxAltFt == null || r.ab > s.maxAltFt) s.maxAltFt = r.ab
  }

  // R2/R3 evidence (attached only if the session classifies as EGLF).
  if (dEglf <= RULE_THRESHOLDS.corridorCheckMaxDistanceNm && (r.ab == null || r.ab <= RULE_MAX_ALT_FT)) {
    if (r.ab != null) {
      let floor: number | null = null
      let zoneLabel = ''
      for (const z of EGLF_ALT_ZONES) {
        if (!pointInPolygon(pos, z.polygon)) continue
        if (floor == null || z.minAltFt! < floor) {
          floor = z.minAltFt!
          zoneLabel = z.label
        }
      }
      if (floor != null && r.ab < floor - RULE_THRESHOLDS.altitudeFloorMarginFt) {
        const deficit = floor - r.ab
        if (!s.r2 || deficit > s.r2.value) {
          s.r2 = { t: r.t, la: r.la, lo: r.lo, ab: r.ab, value: deficit, label: `${floor.toLocaleString()} ft+ ("${zoneLabel}")` }
        }
      }
    }
    if (!EGLF_SWATHS.some((c) => pointInPolygon(pos, c.polygon))) {
      const alt = r.ab ?? RULE_MAX_ALT_FT
      if (!s.r3 || alt < s.r3.value) {
        s.r3 = { t: r.t, la: r.la, lo: r.lo, ab: r.ab ?? null, value: alt, label: `${dEglf.toFixed(1)} nm` }
      }
    }
  }
}

// ── Session classification ───────────────────────────────────────────────────
type Movement = 'dep' | 'arr' | 'local' | null
type Basis = 'ground' | 'geometry' | null

type Classified = {
  airport: MovementField | null
  movement: Movement
  basis: Basis
  takeoffTs: number | null
  landingTs: number | null
}

/** Vertical evidence for an endpoint takeoff/landing: |vr| beyond this, or very
 * low. A LEVEL track that drops out of coverage near a field is a dropout, not
 * a movement — without this gate, mid-altitude transits get logged as arrivals. */
const ENDPOINT_VR_FPM = 200
const ENDPOINT_VERY_LOW_FT = 1500

function endpointField(r: Rec, phase: 'appeared' | 'vanished'): MovementField | null {
  // Nearest field wins (EGLF/EGLK are ~3 nm apart); endpoint must be low & close.
  let best: { f: MovementField; d: number } | null = null
  for (const f of FIELDS) {
    const d = haversineNm({ lat: r.la, lon: r.lo }, AIRPORTS[f].position)
    if (d <= ENDPOINT_NEAR[f].nm && (!best || d < best.d)) best = { f, d }
  }
  if (!best) return null
  if (r.g) return best.f
  const alt = r.ab
  if (alt == null || alt > ENDPOINT_NEAR[best.f].altFt) return null
  const vertical =
    alt <= ENDPOINT_VERY_LOW_FT ||
    (r.vr != null && (phase === 'appeared' ? r.vr >= ENDPOINT_VR_FPM : r.vr <= -ENDPOINT_VR_FPM))
  return vertical ? best.f : null
}

function classify(s: Session): Classified {
  if (s.groundOnly) {
    const f = endpointField(s.first, 'appeared')
    return { airport: f, movement: null, basis: f ? 'ground' : null, takeoffTs: null, landingTs: null }
  }

  // Ground truth: on the ground at a field before and/or after being airborne.
  const depField = FIELDS.find((f) => s.groundBefore[f] != null) ?? null
  const arrField = FIELDS.find((f) => s.groundAfter[f] != null) ?? null
  if (depField && arrField) {
    return {
      airport: depField,
      movement: 'local',
      basis: 'ground',
      takeoffTs: s.firstAirborneTs,
      landingTs: s.groundAfter[arrField]!,
    }
  }
  if (depField) {
    return { airport: depField, movement: 'dep', basis: 'ground', takeoffTs: s.firstAirborneTs, landingTs: null }
  }
  if (arrField) {
    return { airport: arrField, movement: 'arr', basis: 'ground', takeoffTs: null, landingTs: s.groundAfter[arrField]! }
  }

  // Geometry fallback: the session APPEARED or VANISHED low over a field —
  // feed coverage missed the ground segment, but the movement is clear.
  const appeared = endpointField(s.first, 'appeared')
  const vanished = endpointField(s.last, 'vanished')
  if (appeared && vanished) {
    return { airport: appeared, movement: 'local', basis: 'geometry', takeoffTs: s.firstTs, landingTs: s.lastTs }
  }
  if (appeared) {
    return { airport: appeared, movement: 'dep', basis: 'geometry', takeoffTs: s.firstTs, landingTs: null }
  }
  if (vanished) {
    return { airport: vanished, movement: 'arr', basis: 'geometry', takeoffTs: null, landingTs: s.lastTs }
  }
  return { airport: null, movement: null, basis: null, takeoffTs: null, landingTs: null }
}

// ── R1 hours (UK local, GMT/BST-aware — mirrors src/lib/rulesEngine.ts) ──────
type UkClock = { minutes: number; weekday: string; isoDate: string; hhmm: string }

function ukClock(epochS: number): UkClock {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London',
    hour12: false,
    weekday: 'short',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(new Date(epochS * 1000))
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? ''
  let hour = parseInt(get('hour'), 10)
  if (hour === 24) hour = 0
  const minute = parseInt(get('minute'), 10)
  return {
    minutes: hour * 60 + minute,
    weekday: get('weekday'),
    isoDate: `${get('year')}-${get('month')}-${get('day')}`,
    hhmm: `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`,
  }
}

const parseHHMM = (v: string) => {
  const [h, m] = v.split(':').map(Number)
  return h * 60 + m
}

type FlagRow = { ruleId: string; severity: string; reason: string; ts: number | null; lat: number | null; lon: number | null; altFt: number | null }

function r1Flag(field: MovementField, kind: 'takeoff' | 'landing', epochS: number): FlagRow | null {
  const clock = ukClock(epochS)
  const dayType = UK_BANK_HOLIDAYS.has(clock.isoDate)
    ? 'bankHoliday'
    : clock.weekday === 'Sat' || clock.weekday === 'Sun'
      ? 'weekend'
      : 'weekday'
  const win = AIRPORTS[field].hours[dayType]
  const open = parseHHMM(win.open)
  const close = parseHHMM(win.close)
  const grace = RULE_THRESHOLDS.hoursGraceMinutes
  if (clock.minutes >= open - grace && clock.minutes < close + grace) return null
  const dayLabel = dayType === 'bankHoliday' ? 'bank holiday' : dayType
  return {
    ruleId: 'R1-hours',
    severity: 'breach',
    reason: `${AIRPORTS[field].name} ${kind} at ${clock.hhmm} UK on a ${dayLabel} — outside permitted hours (${win.open}–${win.close}). Likely breach.`,
    ts: epochS,
    lat: null,
    lon: null,
    altFt: null,
  }
}

function sessionFlags(s: Session, c: Classified): FlagRow[] {
  const flags: FlagRow[] = []
  if (c.airport && c.basis) {
    if (c.takeoffTs != null) {
      const f = r1Flag(c.airport, 'takeoff', c.takeoffTs)
      if (f) flags.push(f)
    }
    if (c.landingTs != null && !flags.length) {
      const f = r1Flag(c.airport, 'landing', c.landingTs)
      if (f) flags.push(f)
    }
  }
  if (c.airport === 'EGLF') {
    if (s.r2) {
      flags.push({
        ruleId: 'R2-altitude',
        severity: 'indicative',
        reason: `${s.r2.ab!.toLocaleString()} ft — below the expected ${s.r2.label} here. Indicative; aircraft on approach are legitimately low.`,
        ts: s.r2.t,
        lat: s.r2.la,
        lon: s.r2.lo,
        altFt: s.r2.ab,
      })
    }
    if (s.r3) {
      flags.push({
        ruleId: 'R3-corridor',
        severity: 'indicative',
        reason: `${s.r3.label} from Farnborough${s.r3.ab != null ? ` at ${s.r3.ab.toLocaleString()} ft` : ''} but outside every published corridor swath. Indicative; review before acting.`,
        ts: s.r3.t,
        lat: s.r3.la,
        lon: s.r3.lo,
        altFt: s.r3.ab,
      })
    }
  }
  return flags
}

// ── D1 schema ────────────────────────────────────────────────────────────────
const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS flights (
    id TEXT PRIMARY KEY,
    day TEXT NOT NULL,
    hex TEXT NOT NULL,
    callsign TEXT, reg TEXT, type TEXT, category TEXT,
    military INTEGER NOT NULL DEFAULT 0,
    first_ts INTEGER NOT NULL, last_ts INTEGER NOT NULL,
    samples INTEGER NOT NULL,
    min_alt_ft INTEGER, max_alt_ft INTEGER,
    min_dist_home_nm REAL, min_dist_eglf_nm REAL,
    airport TEXT, movement TEXT, basis TEXT,
    ground_only INTEGER NOT NULL DEFAULT 0,
    takeoff_ts INTEGER, landing_ts INTEGER,
    origin_icao TEXT, origin_label TEXT,
    destination_icao TEXT, destination_label TEXT
  )`,
  `CREATE INDEX IF NOT EXISTS idx_flights_day ON flights(day)`,
  `CREATE INDEX IF NOT EXISTS idx_flights_hex ON flights(hex)`,
  `CREATE INDEX IF NOT EXISTS idx_flights_callsign ON flights(callsign)`,
  `CREATE TABLE IF NOT EXISTS flight_flags (
    flight_id TEXT NOT NULL,
    rule_id TEXT NOT NULL,
    severity TEXT NOT NULL,
    reason TEXT NOT NULL,
    ts INTEGER, lat REAL, lon REAL, alt_ft INTEGER,
    PRIMARY KEY (flight_id, rule_id)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_flags_rule ON flight_flags(rule_id)`,
  `CREATE TABLE IF NOT EXISTS daily_stats (
    day TEXT PRIMARY KEY,
    flights_total INTEGER NOT NULL,
    eglf_dep INTEGER NOT NULL, eglf_arr INTEGER NOT NULL,
    eglf_ground_basis INTEGER NOT NULL, eglf_geometry_basis INTEGER NOT NULL,
    eglk_dep INTEGER NOT NULL, eglk_arr INTEGER NOT NULL,
    breach_count INTEGER NOT NULL, indicative_count INTEGER NOT NULL,
    weekend INTEGER NOT NULL, bank_holiday INTEGER NOT NULL,
    records INTEGER NOT NULL,
    rolled_up_at INTEGER NOT NULL
  )`,
]

// Columns added after the original schema; applied idempotently to existing
// tables ("duplicate column" errors are the already-migrated case).
const MIGRATIONS = [
  `ALTER TABLE flights ADD COLUMN origin_icao TEXT`,
  `ALTER TABLE flights ADD COLUMN origin_label TEXT`,
  `ALTER TABLE flights ADD COLUMN destination_icao TEXT`,
  `ALTER TABLE flights ADD COLUMN destination_label TEXT`,
]

async function ensureSchema(db: D1Database): Promise<void> {
  await db.batch(SCHEMA.map((sql) => db.prepare(sql)))
  for (const sql of MIGRATIONS) {
    try {
      await db.prepare(sql).run()
    } catch {
      /* column already exists */
    }
  }
}

// ── gunzip (duplicated tiny helper; capture.ts keeps its own private copy) ───
async function gunzipToText(body: ReadableStream): Promise<string> {
  return await new Response(body.pipeThrough(new DecompressionStream('gzip'))).text()
}

// ── Rollup ───────────────────────────────────────────────────────────────────
export type RollupResult = {
  day: string
  records: number
  flights: number
  flagged: number
  stats: Record<string, number | string>
}

export async function rollupDay(
  env: HistoryEnv,
  day: string,
  lookupRoute?: RouteLookupFn,
): Promise<RollupResult> {
  const bucket = env.TELEMETRY
  const db = env.HISTORY
  if (!bucket) throw new Error('TELEMETRY binding missing')
  if (!db) throw new Error('HISTORY D1 binding missing')
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day)
  if (!m) throw new Error(`bad day: ${day}`)

  const obj = await bucket.get(`raw/${m[1]}/${m[2]}/${m[3]}.ndjson.gz`)
  if (!obj) throw new Error(`no day file for ${day} (has it been compacted yet?)`)
  const text = await gunzipToText(obj.body)

  // Sessionize. The day file is chronological (minute keys sort by time), so a
  // per-hex live session either continues or, after a >10 min gap, finalizes.
  const live = new Map<string, Session>()
  const done: Session[] = []
  let records = 0
  for (const line of text.split('\n')) {
    if (!line) continue
    let r: Rec
    try {
      r = JSON.parse(line) as Rec
    } catch {
      continue
    }
    records++
    let s = live.get(r.i)
    if (s && r.t - s.lastTs > SESSION_GAP_S) {
      done.push(s)
      s = undefined
    }
    if (!s) {
      s = newSession(r)
      live.set(r.i, s)
    }
    addSample(s, r)
  }
  done.push(...live.values())

  // Classify + flag.
  const rows = done.map((s) => {
    const c = classify(s)
    return { s, c, flags: sessionFlags(s, c), route: null as RouteLite | null }
  })

  // Persist routes for the flights that matter (airport movements + flagged) —
  // bounded and memoized per callsign, serialized to respect the route DB.
  if (lookupRoute) {
    const memo = new Map<string, RouteLite | null>()
    let fresh = 0
    for (const row of rows) {
      const cs = row.s.callsign
      if (!cs) continue
      if (!(row.flags.length > 0 || (row.c.airport && row.c.movement))) continue
      let r = memo.get(cs)
      if (r === undefined) {
        if (fresh >= ROUTE_LOOKUP_CAP) continue
        fresh++
        r = await lookupRoute(cs).catch(() => null)
        memo.set(cs, r)
      }
      row.route = r
    }
  }

  // Stats.
  const stat = {
    flights_total: 0,
    eglf_dep: 0,
    eglf_arr: 0,
    eglf_ground_basis: 0,
    eglf_geometry_basis: 0,
    eglk_dep: 0,
    eglk_arr: 0,
    breach_count: 0,
    indicative_count: 0,
  }
  for (const { s, c, flags } of rows) {
    if (!s.groundOnly) stat.flights_total++
    const dep = c.movement === 'dep' || c.movement === 'local' ? 1 : 0
    const arr = c.movement === 'arr' || c.movement === 'local' ? 1 : 0
    if (c.airport === 'EGLF') {
      stat.eglf_dep += dep
      stat.eglf_arr += arr
      if (c.movement) {
        if (c.basis === 'ground') stat.eglf_ground_basis++
        else if (c.basis === 'geometry') stat.eglf_geometry_basis++
      }
    } else if (c.airport === 'EGLK') {
      stat.eglk_dep += dep
      stat.eglk_arr += arr
    }
    for (const f of flags) {
      if (f.severity === 'breach') stat.breach_count++
      else stat.indicative_count++
    }
  }
  const noon = ukClock(Math.floor(Date.parse(`${day}T12:00:00Z`) / 1000))
  const weekend = noon.weekday === 'Sat' || noon.weekday === 'Sun' ? 1 : 0
  const bankHoliday = UK_BANK_HOLIDAYS.has(day) ? 1 : 0

  // Write (idempotent per day: delete + re-insert).
  await ensureSchema(db)
  await db.batch([
    db.prepare(`DELETE FROM flight_flags WHERE flight_id IN (SELECT id FROM flights WHERE day = ?)`).bind(day),
    db.prepare(`DELETE FROM flights WHERE day = ?`).bind(day),
  ])

  const inserts: D1PreparedStatement[] = []
  const insFlight = db.prepare(
    `INSERT INTO flights (id, day, hex, callsign, reg, type, category, military,
       first_ts, last_ts, samples, min_alt_ft, max_alt_ft, min_dist_home_nm,
       min_dist_eglf_nm, airport, movement, basis, ground_only, takeoff_ts, landing_ts,
       origin_icao, origin_label, destination_icao, destination_label)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  )
  const insFlag = db.prepare(
    `INSERT INTO flight_flags (flight_id, rule_id, severity, reason, ts, lat, lon, alt_ft)
     VALUES (?,?,?,?,?,?,?,?)`,
  )
  let flagged = 0
  for (const { s, c, flags, route } of rows) {
    const id = `${day}-${s.hex}-${s.firstTs}`
    inserts.push(
      insFlight.bind(
        id, day, s.hex, s.callsign, s.reg, s.type, s.category, s.military ? 1 : 0,
        s.firstTs, s.lastTs, s.samples, s.minAltFt, s.maxAltFt,
        s.minDistHomeNm != null ? Math.round(s.minDistHomeNm * 10) / 10 : null,
        s.minDistEglfNm != null ? Math.round(s.minDistEglfNm * 10) / 10 : null,
        c.airport, c.movement, c.basis, s.groundOnly ? 1 : 0, c.takeoffTs, c.landingTs,
        route?.originIcao ?? null, route?.originLabel ?? null,
        route?.destinationIcao ?? null, route?.destinationLabel ?? null,
      ),
    )
    if (flags.length) flagged++
    for (const f of flags) {
      inserts.push(insFlag.bind(id, f.ruleId, f.severity, f.reason, f.ts, f.lat, f.lon, f.altFt))
    }
  }
  for (let i = 0; i < inserts.length; i += 50) await db.batch(inserts.slice(i, i + 50))

  await db
    .prepare(
      `INSERT OR REPLACE INTO daily_stats (day, flights_total, eglf_dep, eglf_arr,
         eglf_ground_basis, eglf_geometry_basis, eglk_dep, eglk_arr, breach_count,
         indicative_count, weekend, bank_holiday, records, rolled_up_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    )
    .bind(
      day, stat.flights_total, stat.eglf_dep, stat.eglf_arr, stat.eglf_ground_basis,
      stat.eglf_geometry_basis, stat.eglk_dep, stat.eglk_arr, stat.breach_count,
      stat.indicative_count, weekend, bankHoliday, records, Date.now(),
    )
    .run()

  return { day, records, flights: done.length, flagged, stats: { ...stat, weekend, bank_holiday: bankHoliday } }
}

// ── Query endpoints (minimal; the History UI arrives in H3) ──────────────────
export async function queryFlights(
  db: D1Database,
  opts: { day: string; airport?: string | null; flagged?: boolean },
): Promise<unknown> {
  await ensureSchema(db)
  const where = [`day = ?`]
  const binds: unknown[] = [opts.day]
  if (opts.airport) {
    where.push(`airport = ?`)
    binds.push(opts.airport)
  }
  if (opts.flagged) where.push(`id IN (SELECT flight_id FROM flight_flags)`)
  const flights = await db
    .prepare(`SELECT * FROM flights WHERE ${where.join(' AND ')} ORDER BY first_ts`)
    .bind(...binds)
    .all()
  const flags = await db
    .prepare(`SELECT * FROM flight_flags WHERE flight_id IN (SELECT id FROM flights WHERE day = ?)`)
    .bind(opts.day)
    .all()
  const byFlight = new Map<string, unknown[]>()
  for (const f of flags.results as { flight_id: string }[]) {
    const list = byFlight.get(f.flight_id) ?? []
    list.push(f)
    byFlight.set(f.flight_id, list)
  }
  return {
    day: opts.day,
    count: flights.results.length,
    flights: (flights.results as { id: string }[]).map((f) => ({ ...f, flags: byFlight.get(f.id) ?? [] })),
  }
}

/**
 * Flagged flights + repeat-offender aggregates over the last `days` days.
 * Grouped by hex (the stable airframe id — callsigns vary per flight).
 */
export async function queryOffenders(db: D1Database, days: number): Promise<unknown> {
  await ensureSchema(db)
  const from = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10)
  const flights = await db
    .prepare(
      `SELECT * FROM flights
       WHERE day >= ? AND id IN (SELECT flight_id FROM flight_flags)
       ORDER BY first_ts DESC`,
    )
    .bind(from)
    .all()
  const flags = await db
    .prepare(
      `SELECT ff.* FROM flight_flags ff
       JOIN flights f ON f.id = ff.flight_id WHERE f.day >= ?`,
    )
    .bind(from)
    .all()
  const byFlight = new Map<string, unknown[]>()
  for (const f of flags.results as { flight_id: string }[]) {
    const list = byFlight.get(f.flight_id) ?? []
    list.push(f)
    byFlight.set(f.flight_id, list)
  }
  type Row = {
    id: string
    day: string
    hex: string
    callsign: string | null
    reg: string | null
    type: string | null
  }
  const merged = (flights.results as Row[]).map((f) => ({ ...f, flags: byFlight.get(f.id) ?? [] }))

  type Offender = {
    hex: string
    reg: string | null
    type: string | null
    callsigns: string[]
    flaggedFlights: number
    breaches: number
    indicative: number
    rules: Record<string, number>
    firstDay: string
    lastDay: string
  }
  const byHex = new Map<string, Offender>()
  for (const f of merged) {
    let o = byHex.get(f.hex)
    if (!o) {
      o = {
        hex: f.hex,
        reg: null,
        type: null,
        callsigns: [],
        flaggedFlights: 0,
        breaches: 0,
        indicative: 0,
        rules: {},
        firstDay: f.day,
        lastDay: f.day,
      }
      byHex.set(f.hex, o)
    }
    if (f.reg) o.reg = f.reg
    if (f.type) o.type = f.type
    if (f.callsign && !o.callsigns.includes(f.callsign)) o.callsigns.push(f.callsign)
    o.flaggedFlights++
    if (f.day < o.firstDay) o.firstDay = f.day
    if (f.day > o.lastDay) o.lastDay = f.day
    for (const fl of f.flags as { rule_id: string; severity: string }[]) {
      o.rules[fl.rule_id] = (o.rules[fl.rule_id] ?? 0) + 1
      if (fl.severity === 'breach') o.breaches++
      else o.indicative++
    }
  }
  const offenders = [...byHex.values()].sort(
    (a, b) => b.breaches - a.breaches || b.flaggedFlights - a.flaggedFlights,
  )
  return { from, days, flights: merged, offenders }
}

export async function queryStats(db: D1Database, from: string, to: string): Promise<unknown> {
  await ensureSchema(db)
  const rows = await db
    .prepare(`SELECT * FROM daily_stats WHERE day >= ? AND day <= ? ORDER BY day`)
    .bind(from, to)
    .all()
  return { from, to, days: rows.results }
}
