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
}: {
  flight: NormalizedFlight
  onClose: () => void
}) {
  const vs = formatVerticalRate(flight.verticalRateFpm)
  const coords =
    flight.lat != null && flight.lon != null
      ? `${flight.lat.toFixed(4)}, ${flight.lon.toFixed(4)}`
      : DASH

  return (
    <div
      className="fixed inset-0 z-[1000] flex items-end justify-center bg-black/50"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-t-2xl border-t border-slate-700 bg-slate-900 p-4 pb-8 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label={`Details for ${flightTitle(flight)}`}
      >
        <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-slate-700" />
        <div className="mb-3 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="truncate text-lg font-bold text-white">{flightTitle(flight)}</div>
            <div className="truncate text-xs text-slate-400">{flightSubtitle(flight)}</div>
          </div>
          <button
            onClick={onClose}
            className="shrink-0 rounded-lg bg-slate-800 px-3 py-1.5 text-sm font-medium text-slate-300"
          >
            Close
          </button>
        </div>

        <div className="grid grid-cols-2 gap-x-6">
          <Row label="Distance" value={formatDistance(flight.distanceNm)} />
          <Row label="Bearing" value={formatBearing(flight.bearingDeg)} />
          <Row label="Altitude (baro)" value={formatAltitude(flight)} />
          <Row
            label="Altitude (geom)"
            value={flight.altGeomFt != null ? `${flight.altGeomFt.toLocaleString()} ft` : DASH}
          />
          <Row label="Ground speed" value={formatSpeed(flight.groundSpeedKt)} />
          <Row label="Vertical rate" value={vs.text} />
          <Row label="Track" value={flight.track != null ? `${Math.round(flight.track)}°` : DASH} />
          <Row
            label="Selected alt"
            value={flight.navAltitudeFt != null ? `${flight.navAltitudeFt.toLocaleString()} ft` : DASH}
          />
          <Row label="Squawk" value={flight.squawk ?? DASH} />
          <Row label="Category" value={flight.category ?? DASH} />
          <Row label="Hex" value={flight.hex ? flight.hex.toUpperCase() : DASH} />
          <Row label="Position" value={coords} />
        </div>

        <p className="mt-3 text-[11px] leading-relaxed text-slate-500">
          Telemetry from volunteer ADS-B feeds — indicative, and may be incomplete. Rule flags and
          complaint generation arrive in later phases.
        </p>
      </div>
    </div>
  )
}
