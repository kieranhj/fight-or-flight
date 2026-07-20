import { WORKER_BASE } from '../config/api'

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
  g: boolean
}

export type TrackAircraft = {
  hex: string
  callsign: string | null
  reg: string | null
  type: string | null
  category: string | null
  military: boolean
  samples: TrackSample[] // chronological
  firstTs: number
  lastTs: number
}

export type ReplayData = {
  day: string
  aircraft: TrackAircraft[]
  records: number
  minTs: number
  maxTs: number
}

/** An aircraft's interpolated state at the playhead. */
export type ReplayPosition = {
  ac: TrackAircraft
  lat: number
  lon: number
  altFt: number | null
  track: number | null
  groundSpeedKt: number | null
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

  const byHex = new Map<string, TrackAircraft>()
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
    let ac = byHex.get(hex)
    if (!ac) {
      ac = {
        hex,
        callsign: null,
        reg: null,
        type: null,
        category: null,
        military: false,
        samples: [],
        firstTs: t,
        lastTs: t,
      }
      byHex.set(hex, ac)
    }
    if (typeof r.c === 'string') ac.callsign = r.c
    if (typeof r.rg === 'string') ac.reg = r.rg
    if (typeof r.ty === 'string') ac.type = r.ty
    if (typeof r.ct === 'string') ac.category = r.ct
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
      g: r.g === 1,
    })
  }

  if (records === 0) throw new Error('The day file contained no usable records.')
  return { day, aircraft: [...byHex.values()], records, minTs, maxTs }
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

/** Everything airborne-or-moving at playhead `tSec`, interpolated. */
export function positionsAt(data: ReplayData, tSec: number): ReplayPosition[] {
  const out: ReplayPosition[] = []
  for (const ac of data.aircraft) {
    if (tSec < ac.firstTs || tSec > ac.lastTs + STALE_S) continue
    const i = lastAtOrBefore(ac.samples, tSec)
    if (i < 0) continue
    const s = ac.samples[i]
    if (tSec - s.t > STALE_S) continue
    const next = ac.samples[i + 1]

    let lat = s.la
    let lon = s.lo
    let altFt = s.ab
    if (next && next.t > s.t && next.t - s.t <= LERP_MAX_GAP_S) {
      const f = (tSec - s.t) / (next.t - s.t)
      lat = lerp(s.la, next.la, f)
      lon = lerp(s.lo, next.lo, f)
      if (s.ab != null && next.ab != null) altFt = Math.round(lerp(s.ab, next.ab, f))
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
      track: s.tr,
      groundSpeedKt: s.gs,
      onGround: s.g,
      trail,
    })
  }
  return out
}
