import { useEffect } from 'react'
import { MapContainer, TileLayer, Marker, Circle, useMap } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import type { NormalizedFlight } from '../lib/adsb'
import type { GeoResult } from '../lib/geolocation'

// Aircraft glyph points north (up) at 0°; we rotate it by the flight's track.
function planeIcon(track: number | null, selected: boolean): L.DivIcon {
  const rot = track ?? 0
  const fill = selected ? '#38bdf8' : '#e2e8f0'
  const stroke = selected ? '#0c4a6e' : '#0f172a'
  const html = `
    <div style="transform: rotate(${rot}deg); width:28px; height:28px; display:flex; align-items:center; justify-content:center;">
      <svg width="26" height="26" viewBox="0 0 24 24" fill="${fill}" stroke="${stroke}" stroke-width="1" stroke-linejoin="round">
        <path d="M12 2 L13.4 11 L21 15 L21 17 L13.4 14.6 L13 20 L16 22 L16 23 L12 21.8 L8 23 L8 22 L11 20 L10.6 14.6 L3 17 L3 15 L10.6 11 Z"/>
      </svg>
    </div>`
  return L.divIcon({
    html,
    className: 'plane-marker',
    iconSize: [28, 28],
    iconAnchor: [14, 14],
  })
}

const userIcon = L.divIcon({
  html: `<div style="width:16px;height:16px;border-radius:50%;background:#0ea5e9;border:3px solid #fff;box-shadow:0 0 0 2px rgba(14,165,233,0.5);"></div>`,
  className: 'user-marker',
  iconSize: [16, 16],
  iconAnchor: [8, 8],
})

/** Fit the map to show the user plus all plotted aircraft (re-runs when they change). */
function FitBounds({ points }: { points: L.LatLngExpression[] }) {
  const map = useMap()
  useEffect(() => {
    if (points.length === 0) return
    if (points.length === 1) {
      map.setView(points[0], 12)
      return
    }
    map.fitBounds(L.latLngBounds(points), { padding: [40, 40], maxZoom: 13 })
  }, [points, map])
  return null
}

export default function MapView({
  pos,
  flights,
  selectedHex,
  onSelect,
}: {
  pos: GeoResult
  flights: NormalizedFlight[]
  selectedHex: string | null
  onSelect: (f: NormalizedFlight) => void
}) {
  const plotted = flights.filter(
    (f): f is NormalizedFlight & { lat: number; lon: number } =>
      f.lat != null && f.lon != null,
  )
  const points: L.LatLngExpression[] = [
    [pos.lat, pos.lon],
    ...plotted.map((f) => [f.lat, f.lon] as L.LatLngExpression),
  ]

  return (
    <div className="h-[55vh] overflow-hidden rounded-xl border border-slate-700">
      <MapContainer
        center={[pos.lat, pos.lon]}
        zoom={12}
        scrollWheelZoom
        style={{ height: '100%', width: '100%', background: '#0f172a' }}
      >
        <TileLayer
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          maxZoom={19}
        />
        <Circle
          center={[pos.lat, pos.lon]}
          radius={pos.accuracyM}
          pathOptions={{ color: '#0ea5e9', weight: 1, fillColor: '#0ea5e9', fillOpacity: 0.1 }}
        />
        <Marker position={[pos.lat, pos.lon]} icon={userIcon} />
        {plotted.map((f) => (
          <Marker
            key={f.hex || `${f.callsign}-${f.lat}-${f.lon}`}
            position={[f.lat, f.lon]}
            icon={planeIcon(f.track, f.hex === selectedHex)}
            zIndexOffset={f.hex === selectedHex ? 1000 : 0}
            eventHandlers={{ click: () => onSelect(f) }}
          />
        ))}
        <FitBounds points={points} />
      </MapContainer>
    </div>
  )
}
