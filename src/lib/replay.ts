import { WORKER_BASE } from '../config/api'
import { AIRPORTS } from '../config/airports'
import { haversineNm } from './geo'

// Day-replay engine (Phase H4). Fetches a day's raw NDJSON track file from the
// Worker, indexes it per aircraft, and answers "where was everything at time T"
// with linear interpolation between samples for smooth scrubbing.

/** One capture record (mirror of the recorder's short-key format). */
export type TrackSample = {
  t: number
  la: number
  lo: number
  ab: number | null
  tr: number | null
  gs: number | null
  vr: number | null
  na: number | null
  g: boolean
}

/**
 * Coarse per-aircraft group for the replay filters, derived from the whole
 * track (mirrors the rollup's session logic): a ground sample near EGLF/EGLK,
 * or an endpoint low over any of the four airports WITH vertical evidence
 * (climbing out / descending in — a level track vanishing near a field is a
 * coverage dropout, not a landing) → that airport; else high-throughout traffic
 * is overhead transit, the rest is other low traffic.
 */
export type ReplayGroup = 'EGLF' | 'EGLK' | 'EGLL' | 'EGKK' | 'low' | 'transit'

/**
 * One flight SESSION (not a whole airframe-day): a hex's samples split on
 * >10 min gaps, mirroring the rollup. Without the split, an airframe that
 * arrives at an airport in the morning and departs in the afternoon has
 * neither day-endpoint near a field (its low pass is mid-track) and every
 * leg mis-groups into "other low".
 */
export type TrackAircraft = {
  /** Session id: hex + first timestamp (map keys; hexes recur across sessions). */
  id: string
  hex: string
  callsign: string | null
  reg: string | null
  type: string | null
  category: string | null
  squawk: string | null
  military: boolean
  samples: TrackSample[] // chronological
  firstTs: number
  lastTs: number
  group: ReplayGroup
}

const SESSION_GAP_S = 600

export type ReplayData = {
  day: string
  aircraft: TrackAircraft[]
  records: number
  minTs: number
  maxTs: number
  groupCounts: Record<ReplayGroup, number>
}

/** Aircraft whose whole airborne track stays at/above this are overhead transit. */
const TRANSIT_MIN_ALT_FT = 4000
/** Endpoint-near-airport thresholds. Heathrow and Gatwick fields are inside the
 * 25 nm capture circle, so their arrivals/departures also start/end low there. */
const ENDPOINT_NEAR = {
  EGLF: { nm: 4, altFt: 2500 },
  EGLK: { nm: 3, altFt: 2000 },
  EGLL: { nm: 4, altFt: 2500 },
  EGKK: { nm: 4, altFt: 2500 },
} as const
type EndpointField = keyof typeof ENDPOINT_NEAR
const ENDPOINT_FIELDS = Object.keys(ENDPOINT_NEAR) as EndpointField[]
const GROUND_NEAR_NM = 3
/** Vertical evidence for an endpoint takeoff/landing: |vr| beyond this, or very
 * low. A LEVEL track vanishing near a field is a coverage dropout, not a
 * landing — this is what keeps mid-altitude transits out of the airport groups. */
const ENDPOINT_VR_FPM = 200
const ENDPOINT_VERY_LOW_FT = 1500

function endpointField(s: TrackSample, phase: 'appeared' | 'vanished'): EndpointField | null {
  if (s.g || s.ab == null) return null
  let best: { f: EndpointField; d: number } | null = null
  for (const f of ENDPOINT_FIELDS) {
    const d = haversineNm({ lat: s.la, lon: s.lo }, AIRPORTS[f].position)
    if (d <= ENDPOINT_NEAR[f].nm && (!best || d < best.d)) best = { f, d }
  }
  if (!best || s.ab > ENDPOINT_NEAR[best.f].altFt) return null
  const vertical =
    s.ab <= ENDPOINT_VERY_LOW_FT ||
    (s.vr != null && (phase === 'appeared' ? s.vr >= ENDPOINT_VR_FPM : s.vr <= -ENDPOINT_VR_FPM))
  return vertical ? best.f : null
}

function groupFor(ac: TrackAircraft): ReplayGroup {
  // Ground contact near a field is decisive (the recorder only keeps ground
  // traffic near EGLF/EGLK, so this can't fire for LHR/LGW).
  for (const s of ac.samples) {
    if (!s.g) continue
    for (const f of ['EGLF', 'EGLK'] as const) {
      if (haversineNm({ lat: s.la, lon: s.lo }, AIRPORTS[f].position) <= GROUND_NEAR_NM) return f
    }
  }
  // Otherwise: climbed out of / descended into an airport at a track endpoint.
  const appeared = endpointField(ac.samples[0], 'appeared')
  if (appeared) return appeared
  const vanished = endpointField(ac.samples[ac.samples.length - 1], 'vanished')
  if (vanished) return vanished

  let minAlt: number | null = null
  for (const s of ac.samples) {
    if (!s.g && s.ab != null && (minAlt == null || s.ab < minAlt)) minAlt = s.ab
  }
  return minAlt != null && minAlt >= TRANSIT_MIN_ALT_FT ? 'transit' : 'low'
}

/** An aircraft's interpolated state at the playhead. */
export type ReplayPosition = {
  ac: TrackAircraft
  lat: number
  lon: number
  altFt: number | null
  track: number | null
  groundSpeedKt: number | null
  verticalRateFpm: number | null
  navAltitudeFt: number | null
  onGround: boolean
  /** Trail points within the trail window before the playhead. */
  trail: [number, number][]
}

/** Aircraft disappear this many seconds after their last sample. */
const STALE_S = 120
/** Interpolate only across gaps up to this long. */
const LERP_MAX_GAP_S = 90
const TRAIL_S = 300

export async function fetchDayTrack(day: string): Promise<ReplayData> {
  const res = await fetch(`${WORKER_BASE}/api/history/day/${day}`)
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null
    throw new Error(body?.error ?? `Replay download failed (HTTP ${res.status})`)
  }
  const text = await res.text()

  // Live session per hex; a >10 min gap finalizes it and starts a new one
  // (the day file is chronological, so this is a single pass).
  const live = new Map<string, TrackAircraft>()
  const sessions: TrackAircraft[] = []
  let records = 0
  let minTs = Infinity
  let maxTs = -Infinity
  for (const line of text.split('\n')) {
    if (!line) continue
    let r: Record<string, unknown>
    try {
      r = JSON.parse(line) as Record<string, unknown>
    } catch {
      continue
    }
    const hex = r.i as string
    const t = r.t as number
    const la = r.la as number
    const lo = r.lo as number
    if (!hex || typeof t !== 'number' || typeof la !== 'number' || typeof lo !== 'number') continue
    records++
    if (t < minTs) minTs = t
    if (t > maxTs) maxTs = t
    let ac = live.get(hex)
    if (ac && t - ac.lastTs > SESSION_GAP_S) {
      sessions.push(ac)
      ac = undefined
    }
    if (!ac) {
      ac = {
        id: `${hex}-${t}`,
        hex,
        callsign: null,
        reg: null,
        type: null,
        category: null,
        squawk: null,
        military: false,
        samples: [],
        firstTs: t,
        lastTs: t,
        group: 'low',
      }
      live.set(hex, ac)
    }
    if (typeof r.c === 'string') ac.callsign = r.c
    if (typeof r.rg === 'string') ac.reg = r.rg
    if (typeof r.ty === 'string') ac.type = r.ty
    if (typeof r.ct === 'string') ac.category = r.ct
    if (typeof r.q === 'string') ac.squawk = r.q
    if (r.m === 1) ac.military = true
    ac.lastTs = t
    ac.samples.push({
      t,
      la,
      lo,
      ab: typeof r.ab === 'number' ? r.ab : null,
      tr: typeof r.tr === 'number' ? r.tr : null,
      gs: typeof r.gs === 'number' ? r.gs : null,
      vr: typeof r.vr === 'number' ? r.vr : null,
      na: typeof r.na === 'number' ? r.na : null,
      g: r.g === 1,
    })
  }

  if (records === 0) throw new Error('The day file contained no usable records.')
  sessions.push(...live.values())
  const aircraft = sessions
  const groupCounts: Record<ReplayGroup, number> = {
    EGLF: 0,
    EGLK: 0,
    EGLL: 0,
    EGKK: 0,
    low: 0,
    transit: 0,
  }
  for (const ac of aircraft) {
    ac.group = groupFor(ac)
    groupCounts[ac.group]++
  }
  return { day, aircraft, records, minTs, maxTs, groupCounts }
}

/** Index of the last sample with t <= target (-1 if none). */
function lastAtOrBefore(samples: TrackSample[], target: number): number {
  let lo = 0
  let hi = samples.length - 1
  let ans = -1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (samples[mid].t <= target) {
      ans = mid
      lo = mid + 1
    } else hi = mid - 1
  }
  return ans
}

const lerp = (a: number, b: number, f: number) => a + (b - a) * f

/** Interpolate a heading along the shortest arc (350° → 10° passes through 0°). */
function lerpAngle(a: number, b: number, f: number): number {
  const d = ((b - a + 540) % 360) - 180
  return (a + d * f + 360) % 360
}

/** Everything airborne-or-moving at playhead `tSec`, interpolated. */
export function positionsAt(
  data: ReplayData,
  tSec: number,
  groups?: ReadonlySet<ReplayGroup>,
): ReplayPosition[] {
  const out: ReplayPosition[] = []
  for (const ac of data.aircraft) {
    if (groups && !groups.has(ac.group)) continue
    if (tSec < ac.firstTs || tSec > ac.lastTs + STALE_S) continue
    const i = lastAtOrBefore(ac.samples, tSec)
    if (i < 0) continue
    const s = ac.samples[i]
    if (tSec - s.t > STALE_S) continue
    const next = ac.samples[i + 1]

    let lat = s.la
    let lon = s.lo
    let altFt = s.ab
    let track = s.tr
    if (next && next.t > s.t && next.t - s.t <= LERP_MAX_GAP_S) {
      const f = (tSec - s.t) / (next.t - s.t)
      lat = lerp(s.la, next.la, f)
      lon = lerp(s.lo, next.lo, f)
      if (s.ab != null && next.ab != null) altFt = Math.round(lerp(s.ab, next.ab, f))
      // Turn the icon smoothly too — headings wrap, so shortest-arc.
      if (s.tr != null && next.tr != null) track = Math.round(lerpAngle(s.tr, next.tr, f))
    }

    const trail: [number, number][] = []
    for (let k = i; k >= 0 && s.t - ac.samples[k].t <= TRAIL_S; k--) {
      trail.push([ac.samples[k].la, ac.samples[k].lo])
    }
    trail.reverse()

    out.push({
      ac,
      lat,
      lon,
      altFt,
      track,
      groundSpeedKt: s.gs,
      verticalRateFpm: s.vr,
      navAltitudeFt: s.na,
      onGround: s.g,
      trail,
    })
  }
  return out
}
