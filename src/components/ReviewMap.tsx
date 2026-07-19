import { MapContainer, TileLayer, Marker } from 'react-leaflet'
import type { LatLngExpression } from 'leaflet'
import 'leaflet/dist/leaflet.css'
import type { ReviewItem } from '../lib/review'
import { topSeverity } from '../lib/assess'
import { useSettings } from './SettingsContext'
import { CorridorOverlay, FitBounds, aircraftIcon } from './MapView'

export default function ReviewMap({
  items,
  selectedId,
  onSelect,
}: {
  items: ReviewItem[]
  selectedId: string | null
  onSelect: (it: ReviewItem) => void
}) {
  const { showCorridors } = useSettings()
  const plotted = items.filter((it) => it.flight.lat != null && it.flight.lon != null)
  const points: LatLngExpression[] = plotted.map(
    (it) => [it.flight.lat as number, it.flight.lon as number] as LatLngExpression,
  )
  const center = points[0] ?? ([51.276, -0.776] as LatLngExpression)

  return (
    <div className="relative h-[55vh] overflow-hidden rounded-xl border border-slate-700">
      <MapContainer
        center={center}
        zoom={11}
        scrollWheelZoom
        style={{ height: '100%', width: '100%', background: '#0f172a' }}
      >
        <TileLayer
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          maxZoom={19}
        />
        <CorridorOverlay show={showCorridors} />
        {plotted.map((it) => (
          <Marker
            key={it.record.id}
            position={[it.flight.lat as number, it.flight.lon as number]}
            icon={aircraftIcon(
              it.flight,
              it.record.id === selectedId,
              topSeverity(it.assessment.flags) === 'breach',
            )}
            zIndexOffset={it.record.id === selectedId ? 1000 : 0}
            eventHandlers={{ click: () => onSelect(it) }}
          />
        ))}
        <FitBounds points={points} recenter={false} />
      </MapContainer>
    </div>
  )
}
