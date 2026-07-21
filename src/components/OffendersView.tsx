import { useEffect, useMemo, useState } from 'react'
import {
  fetchOffenders,
  FLAG_SHORT,
  type HistoryFlight,
  type OffenderSummary,
} from '../lib/history'
import type { NormalizedFlight } from '../lib/adsb'
import { HOME_LOCATION } from '../config/airports'
import { haversineNm, bearingDeg } from '../lib/geo'
import { useSettings } from './SettingsContext'
import { formatAltitudeFt } from '../lib/format'
import FlagBadge from './FlagBadge'
import ComplaintModal from './ComplaintModal'
import type { Flag } from '../lib/rulesEngine'
import type { HistoryFlag } from '../lib/history'

// Offenders tab (Phase H5): every auto-flagged flight across the recorded
// history, aggregated into a repeat-offender table by airframe, with jumps into
// replay and post-hoc complaints (never auto-sent).

const WINDOWS = [
  { days: 7, label: '7 days' },
  { days: 30, label: '30 days' },
  { days: 90, label: '90 days' },
  { days: 365, label: 'Year' },
] as const

const toFlag = (f: HistoryFlag): Flag => ({
  ruleId: f.rule_id,
  severity: f.severity,
  short: FLAG_SHORT[f.rule_id] ?? f.rule_id,
  reason: f.reason,
})

const UK_CLOCK = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/London',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
})
const clock = (tsS: number | null) => (tsS != null ? UK_CLOCK.format(new Date(tsS * 1000)) : '—')
const dayLabel = (day: string) =>
  new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London',
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  }).format(new Date(`${day}T12:00:00Z`))

/** The flag moment: the evidence timestamp a post-hoc complaint is about. */
function flagMoment(f: HistoryFlight): number {
  return f.flags.find((fl) => fl.ts != null)?.ts ?? f.landing_ts ?? f.takeoff_ts ?? f.first_ts
}

/** Rebuild a NormalizedFlight at the flag's moment from the D1 row. */
function toComplaintFlight(f: HistoryFlight): NormalizedFlight {
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
    distanceNm: pos ? Math.round(haversineNm(pos, HOME_LOCATION) * 10) / 10 : f.min_dist_home_nm,
    bearingDeg: pos ? Math.round(bearingDeg(HOME_LOCATION, pos)) : null,
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

// ── CSV export (matches the evidence people attach to representations) ───────
function csvCell(v: string | number | null): string {
  const s = v == null ? '' : String(v)
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

function offendersCsv(flights: HistoryFlight[]): string {
  const headers = [
    'day', 'first_seen_utc', 'last_seen_utc', 'callsign', 'registration', 'hex', 'type',
    'airport', 'movement', 'basis', 'takeoff_utc', 'landing_utc', 'min_alt_ft',
    'origin', 'destination', 'rules', 'reasons',
  ]
  const iso = (t: number | null) => (t != null ? new Date(t * 1000).toISOString() : '')
  const rows = flights.map((f) =>
    [
      f.day, iso(f.first_ts), iso(f.last_ts), f.callsign, f.reg, f.hex, f.type,
      f.airport, f.movement, f.basis, iso(f.takeoff_ts), iso(f.landing_ts), f.min_alt_ft,
      f.origin_label ?? f.origin_icao, f.destination_label ?? f.destination_icao,
      f.flags.map((fl) => fl.rule_id).join('; '),
      f.flags.map((fl) => fl.reason).join(' | '),
    ]
      .map(csvCell)
      .join(','),
  )
  return [headers.join(','), ...rows].join('\n')
}

function download(name: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv' }))
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  URL.revokeObjectURL(url)
}

// ── Rows ─────────────────────────────────────────────────────────────────────
function FlaggedRow({
  f,
  onReplay,
  onComplain,
}: {
  f: HistoryFlight
  onReplay: (f: HistoryFlight) => void
  onComplain: (f: HistoryFlight) => void
}) {
  const { units } = useSettings()
  const route =
    f.origin_label || f.destination_label
      ? `${f.origin_label ?? '?'} → ${f.destination_label ?? '?'}`
      : null
  return (
    <li className="rounded-xl border border-slate-700 bg-slate-800/60 p-3">
      <div className="flex items-baseline justify-between gap-2">
        <div className="truncate text-sm font-bold text-white">
          {f.callsign ?? f.reg ?? f.hex.toUpperCase()}
          <span className="ml-2 font-normal text-slate-400">{dayLabel(f.day)}</span>
        </div>
        <div className="shrink-0 text-xs tabular-nums text-slate-400">
          {clock(f.first_ts)}–{clock(f.last_ts)}
        </div>
      </div>
      <div className="truncate text-xs text-slate-400">
        {[f.type, route].filter(Boolean).join(' · ') || f.hex.toUpperCase()}
      </div>
      <div className="mt-1.5 flex flex-wrap gap-1.5">
        {f.flags.map((fl) => (
          <FlagBadge key={fl.rule_id} flag={toFlag(fl)} />
        ))}
      </div>
      {f.flags[0] && (
        <p className="mt-1.5 text-[11px] leading-relaxed text-slate-500">{f.flags[0].reason}</p>
      )}
      <div className="mt-2 flex items-center justify-between text-[11px] text-slate-500">
        <span>
          {f.min_alt_ft != null && `${formatAltitudeFt(f.min_alt_ft, units.alt)} min`}
        </span>
        <span className="flex gap-3">
          <button onClick={() => onReplay(f)} className="font-semibold text-sky-400">
            View in replay →
          </button>
          <button onClick={() => onComplain(f)} className="font-semibold text-sky-400">
            Complain
          </button>
        </span>
      </div>
    </li>
  )
}

function OffenderCard({
  o,
  flights,
  onReplay,
  onComplain,
}: {
  o: OffenderSummary
  flights: HistoryFlight[]
  onReplay: (f: HistoryFlight) => void
  onComplain: (f: HistoryFlight) => void
}) {
  const [open, setOpen] = useState(false)
  const mine = useMemo(() => flights.filter((f) => f.hex === o.hex), [flights, o.hex])
  return (
    <li className="rounded-xl border border-slate-700 bg-slate-800/60 p-3">
      <button className="w-full text-left" onClick={() => setOpen((v) => !v)}>
        <div className="flex items-baseline justify-between gap-2">
          <div className="truncate text-sm font-bold text-white">
            {o.reg ?? o.hex.toUpperCase()}
            {o.type && <span className="ml-2 font-normal text-slate-400">{o.type}</span>}
          </div>
          <div className="shrink-0 text-xs font-semibold text-slate-300">
            {o.flaggedFlights}× flagged
          </div>
        </div>
        <div className="truncate text-xs text-slate-400">
          {o.callsigns.join(', ') || o.hex.toUpperCase()}
        </div>
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11px]">
          {o.breaches > 0 && (
            <span className="rounded-full border border-rose-500/60 bg-rose-500/20 px-2 py-0.5 font-semibold text-rose-200">
              ⚠ {o.breaches} breach{o.breaches > 1 ? 'es' : ''}
            </span>
          )}
          {Object.entries(o.rules).map(([rule, n]) => (
            <span key={rule} className="text-slate-500">
              {FLAG_SHORT[rule] ?? rule} ×{n}
            </span>
          ))}
          <span className="ml-auto text-slate-500">
            {o.firstDay === o.lastDay ? dayLabel(o.lastDay) : `${dayLabel(o.firstDay)} – ${dayLabel(o.lastDay)}`}
          </span>
        </div>
      </button>
      {open && (
        <ul className="mt-2 space-y-2 border-t border-slate-700/60 pt-2">
          {mine.map((f) => (
            <FlaggedRow key={f.id} f={f} onReplay={onReplay} onComplain={onComplain} />
          ))}
        </ul>
      )}
    </li>
  )
}

// ── View ─────────────────────────────────────────────────────────────────────
export default function OffendersView({
  onReplayJump,
}: {
  onReplayJump: (day: string, tSec: number) => void
}) {
  const [days, setDays] = useState<number>(90)
  const [data, setData] = useState<{ flights: HistoryFlight[]; offenders: OffenderSummary[] } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [complainFor, setComplainFor] = useState<HistoryFlight | null>(null)

  useEffect(() => {
    let stale = false
    setData(null)
    setError(null)
    fetchOffenders(days)
      .then((d) => !stale && setData(d))
      .catch((e) => !stale && setError(e instanceof Error ? e.message : String(e)))
    return () => {
      stale = true
    }
  }, [days])

  const onReplay = (f: HistoryFlight) => onReplayJump(f.day, flagMoment(f))

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <div className="flex flex-1 rounded-lg border border-slate-700 bg-slate-800/50 p-0.5 text-xs font-medium">
          {WINDOWS.map((w) => (
            <button
              key={w.days}
              onClick={() => setDays(w.days)}
              className={`flex-1 rounded-md px-2 py-1.5 transition ${
                days === w.days ? 'bg-sky-500 text-white' : 'text-slate-400'
              }`}
            >
              {w.label}
            </button>
          ))}
        </div>
        <button
          onClick={() => data && download(`offenders-${days}d.csv`, offendersCsv(data.flights))}
          disabled={!data || data.flights.length === 0}
          className="shrink-0 rounded-lg border border-slate-700 px-3 py-1.5 text-xs font-medium text-slate-300 disabled:opacity-40"
        >
          Export CSV
        </button>
      </div>

      {error && (
        <p className="rounded-lg border border-rose-500/40 bg-rose-500/10 p-3 text-sm text-rose-300">
          {error}
        </p>
      )}
      {!error && data == null && <p className="p-3 text-center text-sm text-slate-400">Loading…</p>}
      {data != null && data.flights.length === 0 && (
        <p className="rounded-lg border border-slate-700 bg-slate-800/40 p-4 text-center text-sm text-slate-400">
          No flagged flights in this window. Quiet skies — or a well-behaved airport.
        </p>
      )}

      {data != null && data.offenders.length > 0 && (
        <>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Repeat offenders · by airframe
          </h3>
          <ul className="space-y-2">
            {data.offenders.map((o) => (
              <OffenderCard
                key={o.hex}
                o={o}
                flights={data.flights}
                onReplay={onReplay}
                onComplain={setComplainFor}
              />
            ))}
          </ul>

          <h3 className="pt-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
            All flagged flights
          </h3>
          <ul className="space-y-2">
            {data.flights.map((f) => (
              <FlaggedRow key={f.id} f={f} onReplay={onReplay} onComplain={setComplainFor} />
            ))}
          </ul>

          <p className="text-[11px] leading-relaxed text-slate-500">
            Flags are indicative, not proof — breaches (out-of-hours movements) are the strongest.
            "View in replay" jumps to the flagged moment; complaints are prefilled with the logged
            time and evidence, and are never sent automatically.
          </p>
        </>
      )}

      {complainFor && (
        <ComplaintModal
          flight={toComplaintFlight(complainFor)}
          observedAt={flagMoment(complainFor) * 1000}
          when={new Date(flagMoment(complainFor) * 1000)}
          flags={complainFor.flags.map(toFlag)}
          zClass="z-[1300]"
          onClose={() => setComplainFor(null)}
        />
      )}
    </div>
  )
}
