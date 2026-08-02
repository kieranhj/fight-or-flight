import { useEffect, useMemo, useState } from 'react'
import {
  fetchOffenders,
  FLAG_SHORT,
  type HistoryFlight,
  type OffendersResponse,
  type OffenderSummary,
} from '../lib/history'
import type { LatLon } from '../config/types'
import { toFlag, flagMoment, toComplaintFlight } from '../lib/historyComplaint'
import { isRotorcraft } from '../config/classification'
import { useSettings } from './SettingsContext'
import { formatAltitudeFt } from '../lib/format'
import FlagBadge from './FlagBadge'
import ComplaintModal from './ComplaintModal'

// "For Review" tab (Phase H5): every auto-flagged flight across the recorded
// history, aggregated by airframe so repeat appearances stand out, with jumps
// into replay and post-hoc complaints (never auto-sent). Named for review, not
// for guilt — R2/R3 flags are indicative and want a human look before acting.

const WINDOWS = [
  { days: 7, label: '7 days' },
  { days: 30, label: '30 days' },
  { days: 90, label: '90 days' },
  { days: 365, label: 'Year' },
] as const

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
      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
        {isRotorcraft(f.category, f.type) && (
          <span className="rounded-full border border-slate-600 bg-slate-700/40 px-2 py-0.5 text-[11px] font-semibold text-slate-300">
            Helicopter
          </span>
        )}
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
  onReplayJump: (day: string, tSec: number, hex: string) => void
}) {
  const settings = useSettings()
  const home: LatLon = { lat: settings.homeLat, lon: settings.homeLon }
  const [days, setDays] = useState<number>(90)
  const [data, setData] = useState<OffendersResponse | null>(null)
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

  const onReplay = (f: HistoryFlight) => onReplayJump(f.day, flagMoment(f), f.hex)

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
          onClick={() => data && download(`flagged-flights-${days}d.csv`, offendersCsv(data.flights))}
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
      {data?.excluded != null && data.excluded.periods.some((p) => p.to >= data.from) && (
        <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs leading-relaxed text-amber-200/90">
          {data.excluded.periods
            .filter((p) => p.to >= data.from)
            .map((p) => (
              <span key={p.from} className="block">
                Excluded: {p.label} ({dayLabel(p.from)} – {dayLabel(p.to)})
              </span>
            ))}
          {data.excluded.flights > 0 && (
            <span className="block">
              {data.excluded.flights} flagged flight{data.excluded.flights === 1 ? '' : 's'} hidden.
            </span>
          )}
        </p>
      )}
      {data != null && data.flights.length === 0 && (
        <p className="rounded-lg border border-slate-700 bg-slate-800/40 p-4 text-center text-sm text-slate-400">
          No flagged flights in this window. Quiet skies — or a well-behaved airport.
        </p>
      )}

      {data != null && data.offenders.length > 0 && (
        <>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Most flagged · by airframe
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
          flight={toComplaintFlight(complainFor, home)}
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
