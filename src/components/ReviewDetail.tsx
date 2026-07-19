import type { ReviewItem } from '../lib/review'
import {
  flightTitle,
  flightSubtitle,
  formatAltitude,
  formatSpeed,
  formatDistance,
  formatBearing,
  formatVerticalRate,
} from '../lib/format'
import { useSettings } from './SettingsContext'
import { AIRPORTS } from '../config/airports'
import { CLASSIFY_THRESHOLDS } from '../config/classification'
import { bearingDeg, angularDiff } from '../lib/geo'
import AirportTag from './AirportTag'
import FlagBadge from './FlagBadge'
import KindTag from './KindTag'

const DASH = '—'

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between border-b border-slate-800 py-2 last:border-0">
      <span className="text-xs text-slate-400">{label}</span>
      <span className="text-right text-sm font-semibold tabular-nums text-slate-100">{value}</span>
    </div>
  )
}

function whenText(d: Date): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London',
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(d)
}

export default function ReviewDetail({
  item,
  onClose,
}: {
  item: ReviewItem
  onClose: () => void
}) {
  const { units } = useSettings()
  const { flight, assessment, corridor, record, when } = item
  const c = assessment.classification

  // Arrival vs departure — needs a logged track.
  let phase = 'Track not logged — can’t determine arrival/departure.'
  if (flight.track != null && c.airport && flight.lat != null && flight.lon != null) {
    const toAirport = bearingDeg({ lat: flight.lat, lon: flight.lon }, AIRPORTS[c.airport].position)
    const arriving = angularDiff(flight.track, toAirport) <= CLASSIFY_THRESHOLDS.headingToleranceDeg
    phase = `Track ${Math.round(flight.track)}° — heading ${arriving ? 'toward (likely arrival)' : 'away (likely departure)'}.`
  }

  const hoursFlag = assessment.flags.find((f) => f.ruleId === 'R1-hours')
  const hoursText = hoursFlag
    ? hoursFlag.reason
    : c.airport
      ? `Within ${AIRPORTS[c.airport].name}’s permitted hours at the logged time.`
      : 'No owning airport, so no hours check.'

  const routeText = flight.route
    ? `${flight.route.originLabel ?? '?'} → ${flight.route.destinationLabel ?? '?'}`
    : 'Not logged'

  const recordedMatches =
    record.airportName && c.airport && AIRPORTS[c.airport].name === record.airportName

  return (
    <div className="fixed inset-0 z-[1300] flex items-end justify-center bg-black/60" onClick={onClose}>
      <div
        className="max-h-[92vh] w-full max-w-md overflow-y-auto overscroll-contain rounded-t-2xl border-t border-slate-700 bg-slate-900 p-4 pb-8 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label={`Review ${flightTitle(flight)}`}
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

        <p className="mb-3 text-xs text-slate-400">Observed {whenText(when)} (UK).</p>

        {/* Recorded at capture */}
        <div className="mb-3 rounded-lg border border-slate-800 bg-slate-800/40 p-2.5">
          <div className="text-[10px] font-medium uppercase tracking-wide text-slate-500">
            As recorded
          </div>
          <p className="mt-1 text-sm text-slate-200">
            {record.airportName ?? 'Unknown'}
            {record.flagsText ? ` · ${record.flagsText}` : ' · no flags'}
          </p>
        </div>

        {/* Re-analysis now */}
        <div className="mb-3 rounded-lg border border-sky-500/25 bg-sky-500/5 p-2.5">
          <div className="mb-1.5 flex items-center gap-2">
            <span className="text-[10px] font-medium uppercase tracking-wide text-slate-500">
              Re-analysis
            </span>
            <AirportTag classification={c} />
            {recordedMatches != null && (
              <span className={`text-[11px] ${recordedMatches ? 'text-emerald-400' : 'text-amber-400'}`}>
                {recordedMatches ? 'matches recorded' : 'differs from recorded'}
              </span>
            )}
          </div>
          <p className="text-xs leading-relaxed text-slate-400">{c.reason}</p>

          <div className="mt-2 space-y-1.5 text-xs text-slate-300">
            <div>
              <span className="text-slate-500">Hours: </span>
              {hoursText}
            </div>
            <div>
              <span className="text-slate-500">Phase: </span>
              {phase}
            </div>
            <div>
              <span className="text-slate-500">Corridor: </span>
              {corridor
                ? corridor.inside
                  ? `Inside a published swath (${corridor.label}).`
                  : `Outside all ${corridor.checked} published corridor swaths for this airport.`
                : 'no corridor configured for this airport.'}
            </div>
            <div>
              <span className="text-slate-500">Route: </span>
              {routeText}
            </div>
          </div>

          {assessment.flags.length > 0 ? (
            <div className="mt-2.5 space-y-2">
              {assessment.flags.map((f) => (
                <div key={f.ruleId} className="rounded-lg border border-slate-800 bg-slate-800/40 p-2">
                  <FlagBadge flag={f} />
                  <p className="mt-1 text-xs leading-relaxed text-slate-400">{f.reason}</p>
                </div>
              ))}
            </div>
          ) : (
            <p className="mt-2 text-xs text-slate-500">No rule flags at the logged time.</p>
          )}
        </div>

        {/* Telemetry */}
        <div className="grid grid-cols-2 gap-x-6">
          <Row label="Altitude" value={formatAltitude(flight, units.alt)} />
          <Row label="Vertical rate" value={formatVerticalRate(flight.verticalRateFpm).text} />
          <Row label="Distance (from observer)" value={formatDistance(flight.distanceNm, units.dist)} />
          <Row label="Bearing" value={formatBearing(flight.bearingDeg)} />
          <Row label="Ground speed" value={formatSpeed(flight.groundSpeedKt, units.speed)} />
          <Row label="Category" value={flight.category ?? DASH} />
          <Row label="Hex" value={flight.hex ? flight.hex.toUpperCase() : DASH} />
          <Row
            label="Position"
            value={
              flight.lat != null && flight.lon != null
                ? `${flight.lat.toFixed(4)}, ${flight.lon.toFixed(4)}`
                : DASH
            }
          />
        </div>

        <p className="mt-3 text-[11px] leading-relaxed text-slate-500">
          Re-analysis uses the current rules/corridors on the logged position, altitude and time.
          Flags are indicative; corridor geometry is still approximate.
        </p>
      </div>
    </div>
  )
}
