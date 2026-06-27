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

export default function FlightCard({ flight }: { flight: NormalizedFlight }) {
  const vs = formatVerticalRate(flight.verticalRateFpm)
  const vsAccent =
    vs.dir === 'up' ? 'text-emerald-400' : vs.dir === 'down' ? 'text-amber-400' : 'text-slate-100'
  const arrow = vs.dir === 'up' ? '▲ ' : vs.dir === 'down' ? '▼ ' : ''

  return (
    <li className="rounded-xl border border-slate-700 bg-slate-800/60 p-3">
      <div className="mb-3 flex items-baseline justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate text-base font-bold text-white">{flightTitle(flight)}</div>
          <div className="truncate text-xs text-slate-400">{flightSubtitle(flight)}</div>
        </div>
        <div className="shrink-0 text-right">
          <div className="text-base font-bold tabular-nums text-sky-400">
            {formatDistance(flight.distanceNm)}
          </div>
          <div className="text-xs text-slate-400">{formatBearing(flight.bearingDeg)}</div>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-x-3 gap-y-2">
        <Stat label="Altitude" value={formatAltitude(flight)} />
        <Stat label="Speed" value={formatSpeed(flight.groundSpeedKt)} />
        <Stat label="Vert. rate" value={`${arrow}${vs.text}`} accent={vsAccent} />
      </div>
    </li>
  )
}
