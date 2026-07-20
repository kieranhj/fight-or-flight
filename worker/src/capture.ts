import { fetchUpstream, isMilitary, num, str, type RawAircraft } from './shared'

// Telemetry recorder (docs/TELEMETRY-CAPTURE-PLAN.md, Phase H1).
//
// Every minute a cron invocation polls the feeds SAMPLES_PER_MINUTE times
// (15 s cadence), trims each aircraft to a compact record, and writes one
// gzipped NDJSON object to R2. Compaction then rolls minutes → hours → days in
// two stages, because R2 binding calls count against the 1,000-subrequest limit
// per invocation (a single day-level pass over 1,440 minute objects would bust
// it; 60 per hour + 24 per day never can).
//
//   minute/YYYY/MM/DD/HHMM.ndjson.gz   written by the capture cron
//   hour/YYYY/MM/DD/HH.ndjson.gz       hourly cron merges the previous hour
//   raw/YYYY/MM/DD.ndjson.gz           daily cron merges the previous UTC day
//   state/last.json                    last successful capture (for /health)
//   state/day-YYYY-MM-DD.json          per-day summary written at day merge
//
// All keys and day boundaries are UTC; the analysis layer (H2+) converts to
// Europe/London where rules need local time.

export interface CaptureEnv {
  /** R2 bucket for recorded telemetry; capture no-ops (with a log) if unbound. */
  TELEMETRY?: R2Bucket
  /** Test hook: base URL of a stub feed server (see docs/PHASE-H1-NOTES.md). */
  UPSTREAM_BASE?: string
}

// ── Capture parameters (agreed in the plan) ──────────────────────────────────
const HOME = { lat: 51.188, lon: -0.802 } // mirrors src/config/airports.ts HOME_LOCATION
const RADIUS_NM = 25
const SAMPLES_PER_MINUTE = 4 // every 15 s
const SAMPLE_INTERVAL_MS = 15_000
/** Ground traffic is kept only near these fields (we track EGLF/EGLK movements
 * gate-to-gate); taxiing aircraft elsewhere (Heathrow/Gatwick are inside 25 nm)
 * are noise. */
const GROUND_FIELDS = [
  { icao: 'EGLF', lat: 51.2758, lon: -0.7763 },
  { icao: 'EGLK', lat: 51.32389, lon: -0.8475 },
]
const GROUND_KEEP_NM = 3

// ── Compact capture record ───────────────────────────────────────────────────
// Short keys + rounded values keep raw NDJSON ~120–150 B/record before gzip.
// Null/absent fields are omitted entirely.
type CaptureRecord = {
  t: number // epoch seconds of the sample
  i: string // hex
  c?: string // callsign
  rg?: string // registration
  ty?: string // type code
  ct?: string // ADS-B category (A1…)
  q?: string // squawk
  la: number // lat, 5 dp
  lo: number // lon, 5 dp
  ab?: number // baro alt ft
  ag?: number // geom alt ft
  gs?: number // ground speed kt
  tr?: number // track deg
  vr?: number // vertical rate fpm
  na?: number // nav (selected) altitude ft
  g?: 1 // on ground
  m?: 1 // military
}

const round5 = (v: number) => Math.round(v * 1e5) / 1e5

function haversineNm(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const R = 3440.065 // nm
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(bLat - aLat)
  const dLon = toRad(bLon - aLon)
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLon / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(s))
}

/** Trim one raw aircraft to a capture record; null to drop it. */
export function toCaptureRecord(ac: RawAircraft, t: number): CaptureRecord | null {
  const la = num(ac.lat)
  const lo = num(ac.lon)
  if (la == null || lo == null) return null // positionless records are unusable
  const hex = str(ac.hex)
  if (!hex) return null

  const onGround = ac.alt_baro === 'ground'
  if (onGround) {
    const nearField = GROUND_FIELDS.some((f) => haversineNm(la, lo, f.lat, f.lon) <= GROUND_KEEP_NM)
    if (!nearField) return null
  }

  const rec: CaptureRecord = { t, i: hex, la: round5(la), lo: round5(lo) }
  const set = <K extends keyof CaptureRecord>(k: K, v: CaptureRecord[K] | null | undefined) => {
    if (v != null) rec[k] = v as CaptureRecord[K]
  }
  set('c', str(ac.flight))
  set('rg', str(ac.r))
  set('ty', str(ac.t))
  set('ct', str(ac.category))
  set('q', str(ac.squawk))
  if (!onGround) set('ab', intOrNull(num(ac.alt_baro)))
  set('ag', intOrNull(num(ac.alt_geom)))
  set('gs', intOrNull(num(ac.gs)))
  set('tr', intOrNull(num(ac.track)))
  set('vr', intOrNull(num(ac.baro_rate) ?? num(ac.geom_rate)))
  set('na', intOrNull(num(ac.nav_altitude_mcp) ?? num(ac.nav_altitude_fms)))
  if (onGround) rec.g = 1
  if (isMilitary(ac)) rec.m = 1
  return rec
}

function intOrNull(v: number | null): number | null {
  return v == null ? null : Math.round(v)
}

// ── gzip helpers (native CompressionStream) ──────────────────────────────────
async function gzip(text: string): Promise<ArrayBuffer> {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'))
  return await new Response(stream).arrayBuffer()
}

async function gunzipToText(body: ReadableStream): Promise<string> {
  return await new Response(body.pipeThrough(new DecompressionStream('gzip'))).text()
}

// ── Key formatting (all UTC) ─────────────────────────────────────────────────
const p2 = (n: number) => String(n).padStart(2, '0')

function utcParts(ms: number) {
  const d = new Date(ms)
  return {
    y: String(d.getUTCFullYear()),
    m: p2(d.getUTCMonth() + 1),
    d: p2(d.getUTCDate()),
    h: p2(d.getUTCHours()),
    min: p2(d.getUTCMinutes()),
  }
}

export function minuteKey(ms: number): string {
  const { y, m, d, h, min } = utcParts(ms)
  return `minute/${y}/${m}/${d}/${h}${min}.ndjson.gz`
}

// ── Capture: one cron invocation = one minute = SAMPLES_PER_MINUTE polls ─────
export async function captureMinute(env: CaptureEnv, scheduledTime: number): Promise<void> {
  const lines: string[] = []
  let samplesOk = 0
  let source: string | null = null

  for (let k = 0; k < SAMPLES_PER_MINUTE; k++) {
    const target = scheduledTime + k * SAMPLE_INTERVAL_MS
    const wait = target - Date.now()
    if (wait > 0) await new Promise((r) => setTimeout(r, wait))
    try {
      const up = await fetchUpstream(HOME.lat, HOME.lon, RADIUS_NM, env.UPSTREAM_BASE)
      const t = Math.round(Date.now() / 1000)
      for (const ac of up.aircraft) {
        const rec = toCaptureRecord(ac, t)
        if (rec) lines.push(JSON.stringify(rec))
      }
      samplesOk++
      source = up.source
    } catch (err) {
      // Failed sample = a gap, never a retry-storm. On a rate-limit, stand down
      // for the REST of the minute too.
      if (/429/.test(String(err))) break
    }
  }

  if (!env.TELEMETRY) {
    console.log('capture: TELEMETRY R2 binding missing — recorded nothing')
    return
  }
  if (samplesOk === 0) return // total gap this minute; visible later as missing key

  const body = await gzip(lines.join('\n') + '\n')
  await env.TELEMETRY.put(minuteKey(scheduledTime), body)
  await env.TELEMETRY.put(
    'state/last.json',
    JSON.stringify({
      t: Date.now(),
      key: minuteKey(scheduledTime),
      samples: samplesOk,
      records: lines.length,
      bytes: body.byteLength,
      source,
    }),
  )
}

// ── Compaction stage 1: minutes → hour ───────────────────────────────────────
async function listKeys(bucket: R2Bucket, prefix: string): Promise<string[]> {
  const keys: string[] = []
  let cursor: string | undefined
  do {
    const page = await bucket.list({ prefix, cursor, limit: 1000 })
    keys.push(...page.objects.map((o) => o.key))
    cursor = page.truncated ? page.cursor : undefined
  } while (cursor)
  return keys.sort()
}

/** Merge gzip members by decompress+concat+recompress (portable and simple). */
async function mergeInto(
  bucket: R2Bucket,
  sourceKeys: string[],
  targetKey: string,
): Promise<{ records: number; bytes: number }> {
  const parts: string[] = []
  let records = 0
  for (const key of sourceKeys) {
    const obj = await bucket.get(key)
    if (!obj) continue
    let text = await gunzipToText(obj.body)
    if (!text.endsWith('\n')) text += '\n'
    records += text.split('\n').length - 1
    parts.push(text)
  }
  const body = await gzip(parts.join(''))
  await bucket.put(targetKey, body)
  return { records, bytes: body.byteLength }
}

async function deleteKeys(bucket: R2Bucket, keys: string[]): Promise<void> {
  for (let i = 0; i < keys.length; i += 1000) await bucket.delete(keys.slice(i, i + 1000))
}

export type CompactResult = {
  target: string
  merged: number
  records: number
  bytes: number
  alreadyExisted: boolean
}

/** Compact one UTC hour's minute objects. `hour` = "YYYY-MM-DDTHH". Idempotent. */
export async function compactHour(env: CaptureEnv, hour: string): Promise<CompactResult> {
  const bucket = env.TELEMETRY
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2})$/.exec(hour)
  if (!bucket || !m) throw new Error(!bucket ? 'TELEMETRY binding missing' : `bad hour: ${hour}`)
  const [, y, mo, d, h] = m
  const prefix = `minute/${y}/${mo}/${d}/${h}`
  const target = `hour/${y}/${mo}/${d}/${h}.ndjson.gz`

  const keys = await listKeys(bucket, prefix)
  const existing = await bucket.head(target)
  let records = 0
  let bytes = existing?.size ?? 0
  if (!existing && keys.length > 0) {
    const merged = await mergeInto(bucket, keys, target)
    records = merged.records
    bytes = merged.bytes
  }
  // Reaching here means the hour file exists (pre-existing, or the merge above
  // succeeded), so the minute objects are safe to delete — including leftovers
  // from a previous run that crashed between merge and delete.
  if (keys.length > 0) await deleteKeys(bucket, keys)
  return { target, merged: keys.length, records, bytes, alreadyExisted: !!existing }
}

// ── Compaction stage 2: hours → day ──────────────────────────────────────────
/** Merge one UTC day's hour objects into the day file. `day` = "YYYY-MM-DD". */
export async function compactDay(env: CaptureEnv, day: string): Promise<CompactResult> {
  const bucket = env.TELEMETRY
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day)
  if (!bucket || !m) throw new Error(!bucket ? 'TELEMETRY binding missing' : `bad day: ${day}`)
  const [, y, mo, d] = m
  const prefix = `hour/${y}/${mo}/${d}/`
  const target = `raw/${y}/${mo}/${d}.ndjson.gz`

  const keys = await listKeys(bucket, prefix)
  const existing = await bucket.head(target)
  let records = 0
  let bytes = existing?.size ?? 0
  if (!existing && keys.length > 0) {
    const merged = await mergeInto(bucket, keys, target)
    records = merged.records
    bytes = merged.bytes
    await bucket.put(
      `state/day-${day}.json`,
      JSON.stringify({ day, hours: keys.length, records, bytes, compactedAt: Date.now() }),
    )
  }
  if (keys.length > 0) await deleteKeys(bucket, keys)
  return { target, merged: keys.length, records, bytes, alreadyExisted: !!existing }
}

// ── Cron plumbing ────────────────────────────────────────────────────────────
/** "YYYY-MM-DDTHH" for the UTC hour BEFORE the given time. */
export function previousHour(ms: number): string {
  const { y, m, d, h } = utcParts(ms - 3_600_000)
  return `${y}-${m}-${d}T${h}`
}

/** "YYYY-MM-DD" for the UTC day BEFORE the given time. */
export function previousDay(ms: number): string {
  const { y, m, d } = utcParts(ms - 86_400_000)
  return `${y}-${m}-${d}`
}

// ── Day track file (for replay) ──────────────────────────────────────────────
export type DayTrack = {
  /** NDJSON text stream of the day's capture records, chronological. */
  body: ReadableStream | string
  /** True when served from the immutable compacted day file. */
  compacted: boolean
}

/**
 * The full NDJSON for one UTC day. Compacted days stream straight from the day
 * file; days still in staging (today, or yesterday before the 00:15 merge) are
 * merged live from their hour + minute objects (≤24 + ≤60 reads — well inside
 * the subrequest limit). Returns null when nothing exists for the day.
 */
export async function dayTrack(env: CaptureEnv, day: string): Promise<DayTrack | null> {
  const bucket = env.TELEMETRY
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day)
  if (!bucket || !m) throw new Error(!bucket ? 'TELEMETRY binding missing' : `bad day: ${day}`)
  const [, y, mo, d] = m

  const compacted = await bucket.get(`raw/${y}/${mo}/${d}.ndjson.gz`)
  if (compacted) {
    return { body: compacted.body.pipeThrough(new DecompressionStream('gzip')), compacted: true }
  }

  // Staging: hour files first, then the current hour's minute objects (both key
  // orders sort chronologically).
  const keys = [
    ...(await listKeys(bucket, `hour/${y}/${mo}/${d}/`)),
    ...(await listKeys(bucket, `minute/${y}/${mo}/${d}/`)),
  ]
  if (keys.length === 0) return null
  const parts: string[] = []
  for (const key of keys) {
    const obj = await bucket.get(key)
    if (!obj) continue
    let text = await gunzipToText(obj.body)
    if (!text.endsWith('\n')) text += '\n'
    parts.push(text)
  }
  return { body: parts.join(''), compacted: false }
}

// ── Health ───────────────────────────────────────────────────────────────────
export async function captureHealth(env: CaptureEnv, now: number): Promise<unknown> {
  if (!env.TELEMETRY) {
    return { recording: false, reason: 'TELEMETRY R2 binding not configured' }
  }
  const [last, yesterday] = await Promise.all([
    env.TELEMETRY.get('state/last.json').then((o) => o?.json() ?? null),
    env.TELEMETRY.get(`state/day-${previousDay(now)}.json`).then((o) => o?.json() ?? null),
  ])
  const lastT = (last as { t?: number } | null)?.t ?? null
  return {
    recording: lastT != null && now - lastT < 5 * 60_000, // captured within 5 min
    lastCapture: last,
    yesterday,
    config: { radiusNm: RADIUS_NM, samplesPerMinute: SAMPLES_PER_MINUTE, groundKeepNm: GROUND_KEEP_NM },
  }
}
