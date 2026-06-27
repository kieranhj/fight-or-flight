import type { NearbyResponse, NormalizedFlight } from '../lib/adsb'
import { formatClock } from '../lib/format'
import FlightCard from './FlightCard'

export default function FlightList({
  result,
  accuracyM,
  onSelect,
}: {
  result: NearbyResponse
  accuracyM?: number
  onSelect?: (f: NormalizedFlight) => void
}) {
  const { flights, query, source, generatedAt } = result

  if (flights.length === 0) {
    return (
      <div className="rounded-xl border border-slate-700 bg-slate-800/40 p-4 text-center">
        <p className="text-sm font-medium text-slate-200">No qualifying aircraft nearby.</p>
        <p className="mt-1 text-xs text-slate-400">
          Nothing within {query.radiusNm} nm after filtering out military, rotorcraft and light
          GA. Free feeds can also miss very low or masked aircraft.
        </p>
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
      <p className="mt-3 text-center text-[11px] leading-relaxed text-slate-500">
        {flights.length} aircraft within {query.radiusNm} nm
        {accuracyM != null && ` · location ±${Math.round(accuracyM)} m`} · via {source} · updated{' '}
        {formatClock(generatedAt)}
      </p>
    </div>
  )
}
