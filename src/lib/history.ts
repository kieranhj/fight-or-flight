import { WORKER_BASE } from '../config/api'

// Client for the Worker's /api/history endpoints (recorded telemetry, Phase H2+).
// Shapes mirror the D1 rows written by worker/src/rollup.ts; SQLite booleans
// arrive as 0/1 numbers.

export type DailyStat = {
  day: string
  flights_total: number
  eglf_dep: number
  eglf_arr: number
  eglf_ground_basis: number
  eglf_geometry_basis: number
  eglk_dep: number
  eglk_arr: number
  breach_count: number
  indicative_count: number
  weekend: number
  bank_holiday: number
  records: number
}

export type HistoryFlag = {
  flight_id: string
  rule_id: string
  severity: 'breach' | 'info' | 'indicative'
  reason: string
  ts: number | null
  lat: number | null
  lon: number | null
  alt_ft: number | null
}

export type HistoryFlight = {
  id: string
  day: string
  hex: string
  callsign: string | null
  reg: string | null
  type: string | null
  category: string | null
  military: number
  first_ts: number
  last_ts: number
  samples: number
  min_alt_ft: number | null
  max_alt_ft: number | null
  min_dist_home_nm: number | null
  min_dist_eglf_nm: number | null
  airport: string | null
  movement: 'dep' | 'arr' | 'local' | null
  basis: 'ground' | 'geometry' | null
  ground_only: number
  takeoff_ts: number | null
  landing_ts: number | null
  flags: HistoryFlag[]
}

/** Badge text for a rule id (D1 stores id+reason; `short` is presentation). */
export const FLAG_SHORT: Record<string, string> = {
  'R1-hours': 'Out of hours',
  'R2-altitude': 'Below profile',
  'R3-corridor': 'Off track',
}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${WORKER_BASE}${path}`)
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null
    throw new Error(body?.error ?? `History request failed (HTTP ${res.status})`)
  }
  return (await res.json()) as T
}

export async function fetchStats(from: string, to: string): Promise<DailyStat[]> {
  const r = await get<{ days: DailyStat[] }>(
    `/api/history/stats?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
  )
  return r.days
}

export async function fetchDayFlights(
  day: string,
  opts: { airport?: string; flagged?: boolean } = {},
): Promise<HistoryFlight[]> {
  const params = new URLSearchParams({ day })
  if (opts.airport) params.set('airport', opts.airport)
  if (opts.flagged) params.set('flagged', '1')
  const r = await get<{ flights: HistoryFlight[] }>(`/api/history/flights?${params}`)
  return r.flights
}

/** Today's UTC date (the recorder's day boundary), YYYY-MM-DD. */
export function todayUtc(): string {
  return new Date().toISOString().slice(0, 10)
}
