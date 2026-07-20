import { useEffect, useMemo, useState } from 'react'
import {
  fetchStats,
  fetchDayFlights,
  todayUtc,
  FLAG_SHORT,
  type DailyStat,
  type HistoryFlight,
  type HistoryFlag,
} from '../lib/history'
import { FARNBOROUGH_PERMITS, RECORDING_START } from '../config/permits'
import { AIRPORTS } from '../config/airports'
import { formatAltitudeFt } from '../lib/format'
import { useSettings } from './SettingsContext'
import FlagBadge from './FlagBadge'
import ReplayView from './ReplayView'
import type { Flag } from '../lib/rulesEngine'

// History tab (Phase H3+H4): stats vs the Farnborough permit caps, a browsable
// per-day flight log (nightly D1 summaries), and a map replay of any recorded
// day (raw track files — including today, merged live).

type Tab = 'stats' | 'flights' | 'replay'
type Filter = 'all' | 'eglf' | 'flagged'

const toFlag = (f: HistoryFlag): Flag => ({
  ruleId: f.rule_id,
  severity: f.severity,
  short: FLAG_SHORT[f.rule_id] ?? f.rule_id,
  reason: f.reason,
})

function dayLabel(day: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London',
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  }).format(new Date(`${day}T12:00:00Z`))
}

// Rule times are UK-local, so history times render Europe/London 24h everywhere.
const UK_CLOCK = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/London',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
})
const clock = (tsS: number | null) => (tsS != null ? UK_CLOCK.format(new Date(tsS * 1000)) : '—')

function airportName(icao: string | null): string {
  return icao && icao in AIRPORTS ? AIRPORTS[icao as keyof typeof AIRPORTS].name : (icao ?? '')
}

/** e.g. "Farnborough departure · ground-truth" / "Blackbushe circuit · inferred". */
function movementText(f: HistoryFlight): string | null {
  if (!f.airport) return null
  const mv =
    f.movement === 'dep'
      ? 'departure'
      : f.movement === 'arr'
        ? 'arrival'
        : f.movement === 'local'
          ? 'circuit (dep + arr)'
          : f.ground_only
            ? 'on the ground'
            : null
  if (!mv) return null
  const basis = f.basis === 'ground' ? 'ground-truth' : f.basis === 'geometry' ? 'inferred' : ''
  return `${airportName(f.airport)} ${mv}${basis ? ` · ${basis}` : ''}`
}

// ── Stats tab ────────────────────────────────────────────────────────────────
function Tile({
  label,
  value,
  sub,
  tone = 'default',
}: {
  label: string
  value: string
  sub: string
  tone?: 'default' | 'alert'
}) {
  return (
    <div className="rounded-xl border border-slate-700 bg-slate-800/60 p-3">
      <div className="text-[11px] font-medium uppercase tracking-wide text-slate-500">{label}</div>
      <div
        className={`mt-1 text-2xl font-bold tabular-nums ${
          tone === 'alert' ? 'text-rose-400' : 'text-slate-100'
        }`}
      >
        {value}
      </div>
      <div className="mt-0.5 text-[11px] leading-snug text-slate-400">{sub}</div>
    </div>
  )
}

function StatsView({
  days,
  onViewDay,
}: {
  days: DailyStat[]
  onViewDay: (day: string) => void
}) {
  const [picked, setPicked] = useState<string | null>(null)

  const totals = useMemo(() => {
    let eglf = 0
    let nonWeekday = 0
    let breaches = 0
    let records = 0
    for (const d of days) {
      const mv = d.eglf_dep + d.eglf_arr
      eglf += mv
      if (d.weekend || d.bank_holiday) nonWeekday += mv
      breaches += d.breach_count
      records += d.records
    }
    return { eglf, nonWeekday, breaches, records }
  }, [days])

  // Last 14 recorded-range days (calendar days, zero-filled), oldest → newest.
  const strip = useMemo(() => {
    const byDay = new Map(days.map((d) => [d.day, d]))
    const out: { day: string; stat: DailyStat | null }[] = []
    const end = new Date(`${todayUtc()}T00:00:00Z`)
    for (let i = 13; i >= 0; i--) {
      const d = new Date(end.getTime() - i * 86_400_000).toISOString().slice(0, 10)
      out.push({ day: d, stat: byDay.get(d) ?? null })
    }
    return out
  }, [days])
  const stripMax = Math.max(1, ...strip.map((s) => (s.stat ? s.stat.eglf_dep + s.stat.eglf_arr : 0)))
  const pickedStat = picked ? (strip.find((s) => s.day === picked)?.stat ?? null) : null

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2.5">
        <Tile
          label="Farnborough movements"
          value={totals.eglf.toLocaleString()}
          sub={`of ${FARNBOROUGH_PERMITS.annualMovementCap.toLocaleString()}/yr permitted`}
        />
        <Tile
          label="Weekend + bank hol."
          value={totals.nonWeekday.toLocaleString()}
          sub={`of ${FARNBOROUGH_PERMITS.nonWeekdayMovementCap.toLocaleString()}/yr permitted`}
        />
        <Tile
          label="Likely breaches"
          value={totals.breaches.toLocaleString()}
          sub="out-of-hours movements"
          tone={totals.breaches > 0 ? 'alert' : 'default'}
        />
        <Tile
          label="Days recorded"
          value={days.length.toLocaleString()}
          sub={`${totals.records.toLocaleString()} position records`}
        />
      </div>

      {/* Farnborough movements per day, last 14 days. Single series; tap a bar to inspect. */}
      <div className="rounded-xl border border-slate-700 bg-slate-800/60 p-3">
        <div className="mb-2 text-[11px] font-medium uppercase tracking-wide text-slate-500">
          Farnborough movements · last 14 days
        </div>
        <div className="flex h-24 items-end gap-1" role="img" aria-label="Daily Farnborough movement counts">
          {strip.map(({ day, stat }) => {
            const v = stat ? stat.eglf_dep + stat.eglf_arr : 0
            const selected = picked === day
            return (
              <button
                key={day}
                onClick={() => setPicked(selected ? null : day)}
                aria-label={`${dayLabel(day)}: ${stat ? `${v} movements` : 'no data'}`}
                className="group flex h-full flex-1 flex-col items-center justify-end"
              >
                <div
                  className={`w-full rounded-t ${
                    !stat ? 'h-px bg-slate-700' : selected ? 'bg-sky-300' : 'bg-sky-500'
                  }`}
                  style={stat ? { height: `${Math.max(4, (v / stripMax) * 100)}%` } : undefined}
                />
              </button>
            )
          })}
        </div>
        <div className="mt-1 flex justify-between text-[10px] text-slate-500">
          <span>{dayLabel(strip[0].day)}</span>
          <span>{dayLabel(strip[strip.length - 1].day)}</span>
        </div>
        {picked && (
          <div className="mt-2 flex items-center justify-between gap-2 rounded-lg bg-slate-900/60 px-2.5 py-1.5 text-xs text-slate-300">
            <span>
              <span className="font-semibold">{dayLabel(picked)}</span>
              {pickedStat
                ? ` — ${pickedStat.eglf_dep} dep · ${pickedStat.eglf_arr} arr` +
                  `${pickedStat.weekend || pickedStat.bank_holiday ? ' · weekend/BH' : ''}` +
                  `${pickedStat.breach_count ? ` · ${pickedStat.breach_count} breach` : ''}`
                : ' — no data recorded'}
            </span>
            {pickedStat && (
              <button
                onClick={() => onViewDay(picked)}
                className="shrink-0 font-semibold text-sky-400"
              >
                View flights →
              </button>
            )}
          </div>
        )}
      </div>

      <p className="text-[11px] leading-relaxed text-slate-500">
        Counts are <span className="font-semibold">minimums</span>: recording began{' '}
        {dayLabel(RECORDING_START)} 2026 and community-feed coverage can miss the lowest part of a
        movement, while the caps apply to full calendar years. {FARNBOROUGH_PERMITS.sourceNote}
      </p>
    </div>
  )
}

// ── Shared day selector ──────────────────────────────────────────────────────
function DaySelect({
  value,
  onChange,
  options,
}: {
  value: string
  onChange: (d: string) => void
  options: { day: string; note?: string }[]
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      aria-label="Day"
      className="min-w-0 flex-1 rounded-lg border border-slate-700 bg-slate-800 px-2.5 py-1.5 text-sm text-slate-200"
    >
      {options.map(({ day, note }) => (
        <option key={day} value={day}>
          {dayLabel(day)}
          {note ? ` — ${note}` : ''}
        </option>
      ))}
    </select>
  )
}

// ── Flights tab ──────────────────────────────────────────────────────────────
function FlightRow({ f, onSelect }: { f: HistoryFlight; onSelect: (f: HistoryFlight) => void }) {
  const { units } = useSettings()
  const mv = movementText(f)
  return (
    <li
      onClick={() => onSelect(f)}
      className="cursor-pointer rounded-xl border border-slate-700 bg-slate-800/60 p-3 transition hover:border-slate-600 active:scale-[0.99]"
    >
      <div className="flex items-baseline justify-between gap-2">
        <div className="truncate text-base font-bold text-white">
          {f.callsign ?? f.reg ?? f.hex.toUpperCase()}
        </div>
        <div className="shrink-0 text-xs tabular-nums text-slate-400">
          {clock(f.first_ts)}–{clock(f.last_ts)}
        </div>
      </div>
      <div className="truncate text-xs text-slate-400">
        {[f.type, f.reg && f.callsign ? f.reg : null, f.military ? 'military' : null]
          .filter(Boolean)
          .join(' · ') || f.hex.toUpperCase()}
      </div>
      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
        {mv && (
          <span
            className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold ${
              f.airport === 'EGLF'
                ? 'border-sky-500/50 bg-sky-500/10 text-sky-200'
                : 'border-slate-600 bg-slate-700/40 text-slate-300'
            }`}
          >
            {mv}
          </span>
        )}
        {f.flags.map((fl) => (
          <FlagBadge key={fl.rule_id} flag={toFlag(fl)} />
        ))}
      </div>
      <div className="mt-1.5 text-[11px] text-slate-500">
        {f.min_alt_ft != null
          ? `${formatAltitudeFt(f.min_alt_ft, units.alt)}–${formatAltitudeFt(f.max_alt_ft, units.alt)}`
          : 'no altitude'}
        {f.min_dist_home_nm != null && ` · closest ${f.min_dist_home_nm} nm from home`}
        {` · ${f.samples} samples`}
      </div>
    </li>
  )
}

function FlightSheet({ f, onClose }: { f: HistoryFlight; onClose: () => void }) {
  const { units } = useSettings()
  const mv = movementText(f)
  const rows: [string, string][] = [
    ['Seen', `${clock(f.first_ts)} – ${clock(f.last_ts)} UK`],
    ['Takeoff', f.takeoff_ts != null ? `${clock(f.takeoff_ts)} UK` : '—'],
    ['Landing', f.landing_ts != null ? `${clock(f.landing_ts)} UK` : '—'],
    [
      'Altitude',
      f.min_alt_ft != null
        ? `${formatAltitudeFt(f.min_alt_ft, units.alt)} – ${formatAltitudeFt(f.max_alt_ft, units.alt)}`
        : '—',
    ],
    ['Closest to home', f.min_dist_home_nm != null ? `${f.min_dist_home_nm} nm` : '—'],
    ['Closest to Farnborough', f.min_dist_eglf_nm != null ? `${f.min_dist_eglf_nm} nm` : '—'],
    ['Type / category', [f.type, f.category].filter(Boolean).join(' · ') || '—'],
    ['Hex / reg', [f.hex.toUpperCase(), f.reg].filter(Boolean).join(' · ')],
    ['Samples', String(f.samples)],
  ]
  return (
    <div className="fixed inset-0 z-[1300] flex items-end justify-center bg-black/60" onClick={onClose}>
      <div
        className="max-h-[92vh] w-full max-w-md overflow-y-auto overscroll-contain rounded-t-2xl border-t border-slate-700 bg-slate-900 p-4 pb-8 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label={`Flight ${f.callsign ?? f.hex}`}
      >
        <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-slate-700" />
        <div className="mb-1 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="truncate text-lg font-bold text-white">
              {f.callsign ?? f.reg ?? f.hex.toUpperCase()}
            </div>
            <div className="text-xs text-slate-400">
              {dayLabel(f.day)}
              {mv ? ` · ${mv}` : ' · not linked to a local airport'}
            </div>
          </div>
          <button
            onClick={onClose}
            className="shrink-0 rounded-lg bg-slate-800 px-3 py-1.5 text-sm font-medium text-slate-300"
          >
            Close
          </button>
        </div>

        {f.flags.length > 0 && (
          <div className="mt-3 space-y-2">
            {f.flags.map((fl) => (
              <div key={fl.rule_id} className="rounded-lg border border-slate-800 bg-slate-800/40 p-2">
                <FlagBadge flag={toFlag(fl)} />
                <p className="mt-1 text-xs leading-relaxed text-slate-400">{fl.reason}</p>
              </div>
            ))}
          </div>
        )}

        <div className="mt-3">
          {rows.map(([label, value]) => (
            <div
              key={label}
              className="flex items-center justify-between border-b border-slate-800 py-2 last:border-0"
            >
              <span className="text-xs text-slate-400">{label}</span>
              <span className="text-right text-sm font-semibold tabular-nums text-slate-100">
                {value}
              </span>
            </div>
          ))}
        </div>

        <p className="mt-3 text-[11px] leading-relaxed text-slate-500">
          From the recorder's nightly summary. Ground-truth movements were seen on the ground at the
          field; inferred ones appeared/vanished low over it. Day replay on the map arrives in a
          later phase.
        </p>
      </div>
    </div>
  )
}

function FlightsView({
  days,
  day,
  onDayChange,
}: {
  days: DailyStat[]
  day: string
  onDayChange: (d: string) => void
}) {
  const [filter, setFilter] = useState<Filter>('all')
  const [flights, setFlights] = useState<HistoryFlight[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<HistoryFlight | null>(null)

  useEffect(() => {
    let stale = false
    setFlights(null)
    setError(null)
    fetchDayFlights(day)
      .then((f) => !stale && setFlights(f))
      .catch((e) => !stale && setError(e instanceof Error ? e.message : String(e)))
    return () => {
      stale = true
    }
  }, [day])

  const shown = useMemo(() => {
    if (!flights) return []
    const airborne = flights.filter((f) => !f.ground_only)
    if (filter === 'eglf') return airborne.filter((f) => f.airport === 'EGLF')
    if (filter === 'flagged') return airborne.filter((f) => f.flags.length > 0)
    return airborne
  }, [flights, filter])

  const FILTERS: { key: Filter; label: string }[] = [
    { key: 'all', label: 'All' },
    { key: 'eglf', label: 'Farnborough' },
    { key: 'flagged', label: 'Flagged' },
  ]

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <DaySelect
          value={day}
          onChange={onDayChange}
          options={days.map((d) => ({ day: d.day, note: `${d.flights_total} flights` }))}
        />
        <div className="flex rounded-lg border border-slate-700 bg-slate-800/50 p-0.5 text-xs font-medium">
          {FILTERS.map(({ key, label }) => (
            <button
              key={key}
              onClick={() => setFilter(key)}
              className={`rounded-md px-2 py-1 transition ${
                filter === key ? 'bg-sky-500 text-white' : 'text-slate-400'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <p className="rounded-lg border border-rose-500/40 bg-rose-500/10 p-3 text-sm text-rose-300">
          {error}
        </p>
      )}
      {!error && flights == null && <p className="p-3 text-center text-sm text-slate-400">Loading…</p>}
      {flights != null && shown.length === 0 && (
        <p className="rounded-lg border border-slate-700 bg-slate-800/40 p-4 text-center text-sm text-slate-400">
          No {filter === 'all' ? '' : filter === 'eglf' ? 'Farnborough ' : 'flagged '}flights
          recorded this day.
        </p>
      )}
      <ul className="space-y-2">
        {shown.map((f) => (
          <FlightRow key={f.id} f={f} onSelect={setSelected} />
        ))}
      </ul>

      {selected && <FlightSheet f={selected} onClose={() => setSelected(null)} />}
    </div>
  )
}

// ── Modal shell ──────────────────────────────────────────────────────────────
export default function HistoryModal({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = useState<Tab>('stats')
  const [days, setDays] = useState<DailyStat[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [day, setDay] = useState<string | null>(null)
  // Replay can show today even before its first nightly rollup (live-merged).
  const [replayDay, setReplayDay] = useState<string>(todayUtc())

  useEffect(() => {
    fetchStats(RECORDING_START, todayUtc())
      .then((d) => {
        const sorted = [...d].sort((a, b) => (a.day < b.day ? 1 : -1))
        setDays(sorted)
        if (sorted.length > 0) setDay(sorted[0].day)
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
  }, [])

  return (
    <div className="fixed inset-0 z-[1200] flex items-end justify-center bg-black/60" onClick={onClose}>
      <div
        className="flex max-h-[94vh] min-h-[70vh] w-full max-w-md flex-col overflow-hidden rounded-t-2xl border-t border-slate-700 bg-slate-900 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="History"
      >
        <div className="shrink-0 border-b border-slate-800 p-4 pb-3">
          <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-slate-700" />
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-lg font-bold text-white">History</h2>
            <button
              onClick={onClose}
              className="shrink-0 rounded-lg bg-slate-800 px-3 py-1.5 text-sm font-medium text-slate-300"
            >
              Close
            </button>
          </div>
          <div className="mt-3 flex rounded-lg border border-slate-700 bg-slate-800/50 p-1 text-sm font-medium">
            {(['stats', 'flights', 'replay'] as const).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`flex-1 rounded-md py-1.5 capitalize transition ${
                  tab === t ? 'bg-sky-500 text-white' : 'text-slate-400'
                }`}
              >
                {t}
              </button>
            ))}
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4">
          {error && (
            <p className="rounded-lg border border-rose-500/40 bg-rose-500/10 p-3 text-sm text-rose-300">
              {error}
            </p>
          )}
          {!error && days == null && (
            <p className="p-3 text-center text-sm text-slate-400">Loading recorded history…</p>
          )}
          {days != null && days.length === 0 && tab !== 'replay' && (
            <p className="rounded-lg border border-slate-700 bg-slate-800/40 p-4 text-center text-sm text-slate-400">
              No summaries yet — the recorder's first nightly rollup lands just after midnight UTC.
              Today's flying is already watchable in the Replay tab.
            </p>
          )}
          {days != null && days.length > 0 && tab === 'stats' && (
            <StatsView
              days={days}
              onViewDay={(d) => {
                setDay(d)
                setTab('flights')
              }}
            />
          )}
          {days != null && days.length > 0 && tab === 'flights' && day && (
            <FlightsView days={days} day={day} onDayChange={setDay} />
          )}
          {days != null && tab === 'replay' && (
            <div className="space-y-3">
              <DaySelect
                value={replayDay}
                onChange={setReplayDay}
                options={[
                  ...(days.some((d) => d.day === todayUtc()) ? [] : [{ day: todayUtc(), note: 'so far' }]),
                  ...days.map((d) => ({ day: d.day })),
                ]}
              />
              <ReplayView key={replayDay} day={replayDay} />
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
