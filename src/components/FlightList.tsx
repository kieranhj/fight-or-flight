import type { NearbyResponse, NormalizedFlight } from '../lib/adsb'
import { formatClock, formatDistance } from '../lib/format'
import { useSettings } from './SettingsContext'
import FlightCard from './FlightCard'

export default function FlightList({
  result,
  accuracyM,
  hiddenCount = 0,
  onSelect,
}: {
  result: NearbyResponse
  accuracyM?: number
  hiddenCount?: number
  onSelect?: (f: NormalizedFlight) => void
}) {
  const { flights, query, source, generatedAt } = result
  const { units } = useSettings()
  const radius = formatDistance(query.radiusNm, units.dist)

  if (flights.length === 0) {
    return (
      <div className="rounded-xl border border-slate-700 bg-slate-800/40 p-4 text-center">
        {hiddenCount > 0 ? (
          <>
            <p className="text-sm font-medium text-slate-200">All nearby aircraft are hidden.</p>
            <p className="mt-1 text-xs text-slate-400">
              {hiddenCount} aircraft within {radius} are hidden by your “Show by type” filters
              (Settings).
            </p>
          </>
        ) : (
          <>
            <p className="text-sm font-medium text-slate-200">No qualifying aircraft nearby.</p>
            <p className="mt-1 text-xs text-slate-400">
              Nothing within {radius} after filtering out military, rotorcraft and light GA. Free
              feeds can also miss very low or masked aircraft.
            </p>
          </>
        )}
      </div>
    )
  }

  return (
    <div>
      <ul className="space-y-2">
        {flights.map((f) => (
          <FlightCard
            key={f.hex || `${f.callsign}-${f.distanceNm}`}
            flight={f}
            onSelect={onSelect}
          />
        ))}
      </ul>
      {result.stale && (
        <p className="mt-3 text-center text-[11px] font-medium text-amber-400/90">
          Feeds momentarily unavailable — showing last good data.
        </p>
      )}
      <p className="mt-1 text-center text-[11px] leading-relaxed text-slate-500">
        {flights.length} aircraft within {radius}
        {hiddenCount > 0 && ` · ${hiddenCount} hidden`}
        {accuracyM != null && ` · location ±${Math.round(accuracyM)} m`} · via {source} · updated{' '}
        {formatClock(generatedAt)}
      </p>
    </div>
  )
}
