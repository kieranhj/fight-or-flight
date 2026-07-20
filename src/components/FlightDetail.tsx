import type { NormalizedFlight } from '../lib/adsb'
import {
  flightTitle,
  flightSubtitle,
  formatAltitude,
  formatAltitudeFt,
  formatSpeed,
  formatVerticalRate,
  formatDistance,
  formatBearing,
} from '../lib/format'
import { assessFlight } from '../lib/assess'
import { useSettings } from './SettingsContext'
import AirportTag from './AirportTag'
import FlagBadge from './FlagBadge'
import KindTag from './KindTag'

const DASH = '—'

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between border-b border-slate-800 py-2 last:border-0">
      <span className="text-xs text-slate-400">{label}</span>
      <span className="text-sm font-semibold tabular-nums text-slate-100">{value}</span>
    </div>
  )
}

export default function FlightDetail({
  flight,
  onClose,
  onComplain,
  when,
  zClass = 'z-[1000]',
}: {
  flight: NormalizedFlight
  onClose: () => void
  /** Omit to hide the complaint button (e.g. historical replay views). */
  onComplain?: (f: NormalizedFlight) => void
  /** Evaluate rules at this moment instead of now (historical replay). */
  when?: Date
  /** Stacking override when shown above higher-z modals. */
  zClass?: string
}) {
  const vs = formatVerticalRate(flight.verticalRateFpm)
  const { classification, flags } = assessFlight(flight, when)
  const { units } = useSettings()
  const coords =
    flight.lat != null && flight.lon != null
      ? `${flight.lat.toFixed(4)}, ${flight.lon.toFixed(4)}`
      : DASH

  return (
    <div
      className={`fixed inset-0 ${zClass} flex items-end justify-center bg-black/50`}
      onClick={onClose}
    >
      <div
        className="max-h-[92vh] w-full max-w-md overflow-y-auto overscroll-contain rounded-t-2xl border-t border-slate-700 bg-slate-900 p-4 pb-8 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label={`Details for ${flightTitle(flight)}`}
      >
        <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-slate-700" />
        <div className="mb-3 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="truncate text-lg font-bold text-white">{flightTitle(flight)}</div>
            <div className="truncate text-xs text-slate-400">{flightSubtitle(flight)}</div>
            <div className="mt-1.5">
              <KindTag flight={flight} />
            </div>
          </div>
          <button
            onClick={onClose}
            className="shrink-0 rounded-lg bg-slate-800 px-3 py-1.5 text-sm font-medium text-slate-300"
          >
            Close
          </button>
        </div>

        <div className="mb-3 rounded-lg border border-slate-800 bg-slate-800/40 p-2.5">
          <div className="mb-1 flex items-center gap-2">
            <span className="text-[10px] font-medium uppercase tracking-wide text-slate-500">
              Likely airport
            </span>
            <AirportTag classification={classification} />
          </div>
          <p className="text-xs leading-relaxed text-slate-400">{classification.reason}</p>
        </div>

        {flags.length > 0 && (
          <div className="mb-3 space-y-2">
            <span className="text-[10px] font-medium uppercase tracking-wide text-slate-500">
              Flags
            </span>
            {flags.map((f) => (
              <div
                key={f.ruleId}
                className="rounded-lg border border-slate-800 bg-slate-800/40 p-2.5"
              >
                <FlagBadge flag={f} />
                <p className="mt-1.5 text-xs leading-relaxed text-slate-400">{f.reason}</p>
              </div>
            ))}
          </div>
        )}

        <div className="grid grid-cols-2 gap-x-6">
          <Row label="Distance" value={formatDistance(flight.distanceNm, units.dist)} />
          <Row label="Bearing" value={formatBearing(flight.bearingDeg)} />
          <Row label="Altitude (baro)" value={formatAltitude(flight, units.alt)} />
          <Row label="Altitude (geom)" value={formatAltitudeFt(flight.altGeomFt, units.alt)} />
          <Row label="Ground speed" value={formatSpeed(flight.groundSpeedKt, units.speed)} />
          <Row label="Vertical rate" value={vs.text} />
          <Row label="Track" value={flight.track != null ? `${Math.round(flight.track)}°` : DASH} />
          <Row label="Selected alt" value={formatAltitudeFt(flight.navAltitudeFt, units.alt)} />
          <Row label="Squawk" value={flight.squawk ?? DASH} />
          <Row label="Category" value={flight.category ?? DASH} />
          <Row label="Hex" value={flight.hex ? flight.hex.toUpperCase() : DASH} />
          <Row label="Position" value={coords} />
          <Row
            label="Route"
            value={
              flight.route
                ? `${flight.route.originLabel ?? '?'} → ${flight.route.destinationLabel ?? '?'}`
                : DASH
            }
          />
        </div>

        {onComplain && (
          <button
            onClick={() => onComplain(flight)}
            className="mt-4 w-full rounded-xl bg-sky-500 px-4 py-3 text-sm font-semibold text-white active:scale-[0.99]"
          >
            Generate complaint
          </button>
        )}

        <p className="mt-3 text-[11px] leading-relaxed text-slate-500">
          Telemetry from volunteer ADS-B feeds — indicative, and may be incomplete. Flags are a
          guide, not proof: review before acting. The complaint is prefilled for you to edit and
          send — it’s never submitted automatically.
        </p>
      </div>
    </div>
  )
}
