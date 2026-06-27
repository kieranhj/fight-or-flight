import type { NormalizedFlight } from '../lib/adsb'
import {
  flightTitle,
  flightSubtitle,
  formatAltitude,
  formatSpeed,
  formatVerticalRate,
  formatDistance,
  formatBearing,
} from '../lib/format'
import { assessFlight } from '../lib/assess'
import { useSettings } from './SettingsContext'
import AirportTag from './AirportTag'
import FlagBadge from './FlagBadge'

function Stat({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div className="flex flex-col">
      <span className="text-[10px] font-medium uppercase tracking-wide text-slate-500">
        {label}
      </span>
      <span className={`text-sm font-semibold tabular-nums ${accent ?? 'text-slate-100'}`}>
        {value}
      </span>
    </div>
  )
}

export default function FlightCard({
  flight,
  onSelect,
}: {
  flight: NormalizedFlight
  onSelect?: (f: NormalizedFlight) => void
}) {
  const vs = formatVerticalRate(flight.verticalRateFpm)
  const vsAccent =
    vs.dir === 'up' ? 'text-emerald-400' : vs.dir === 'down' ? 'text-amber-400' : 'text-slate-100'
  const arrow = vs.dir === 'up' ? '▲ ' : vs.dir === 'down' ? '▼ ' : ''
  const { classification, flags } = assessFlight(flight)
  const { units } = useSettings()

  return (
    <li
      onClick={onSelect ? () => onSelect(flight) : undefined}
      className={`rounded-xl border border-slate-700 bg-slate-800/60 p-3 ${
        onSelect ? 'cursor-pointer transition active:scale-[0.99] hover:border-slate-600' : ''
      }`}
    >
      <div className="mb-3 flex items-baseline justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate text-base font-bold text-white">{flightTitle(flight)}</div>
          <div className="truncate text-xs text-slate-400">{flightSubtitle(flight)}</div>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            <AirportTag classification={classification} />
            {flags.map((f) => (
              <FlagBadge key={f.ruleId} flag={f} />
            ))}
          </div>
        </div>
        <div className="shrink-0 text-right">
          <div className="text-base font-bold tabular-nums text-sky-400">
            {formatDistance(flight.distanceNm, units.dist)}
          </div>
          <div className="text-xs text-slate-400">{formatBearing(flight.bearingDeg)}</div>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-x-3 gap-y-2">
        <Stat label="Altitude" value={formatAltitude(flight, units.alt)} />
        <Stat label="Speed" value={formatSpeed(flight.groundSpeedKt, units.speed)} />
        <Stat label="Vert. rate" value={`${arrow}${vs.text}`} accent={vsAccent} />
      </div>
    </li>
  )
}
