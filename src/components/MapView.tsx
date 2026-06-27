import { Fragment, useEffect } from 'react'
import { MapContainer, TileLayer, Marker, Circle, Polygon, Polyline, useMap } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import type { NormalizedFlight } from '../lib/adsb'
import type { GeoResult } from '../lib/geolocation'
import { assessFlight, topSeverity } from '../lib/assess'
import { useSettings } from './SettingsContext'
import { CORRIDORS, type CorridorKind } from '../config/corridors'
import { corridorSwath } from '../lib/geo'

// Corridor overlay colours, keyed by type.
const CORRIDOR_COLOUR: Record<CorridorKind, string> = {
  departure: '#f59e0b', // amber
  arrival: '#2dd4bf', // teal
}

function CorridorOverlay() {
  return (
    <>
      {CORRIDORS.map((c) => {
        const colour = CORRIDOR_COLOUR[c.kind]
        const swath = corridorSwath(c.centreline, c.toleranceNm).map(
          (p) => [p.lat, p.lon] as L.LatLngExpression,
        )
        const line = c.centreline.map((p) => [p.lat, p.lon] as L.LatLngExpression)
        return (
          <Fragment key={c.id}>
            {swath.length > 0 && (
              <Polygon
                positions={swath}
                pathOptions={{
                  color: colour,
                  weight: 1,
                  opacity: 0.5,
                  fillColor: colour,
                  fillOpacity: 0.12,
                  interactive: false,
                }}
              />
            )}
            <Polyline
              positions={line}
              pathOptions={{
                color: colour,
                weight: 2,
                opacity: 0.7,
                dashArray: '5 5',
                interactive: false,
              }}
            />
          </Fragment>
        )
      })}
    </>
  )
}

// Aircraft glyph points north (up) at 0°; we rotate it by the flight's track.
// Selected = sky-blue (overrides); a possible-breach flight = rose; else slate.
function planeIcon(track: number | null, selected: boolean, breach: boolean): L.DivIcon {
  const rot = track ?? 0
  const fill = selected ? '#38bdf8' : breach ? '#fb7185' : '#e2e8f0'
  const stroke = selected ? '#0c4a6e' : breach ? '#7f1d1d' : '#0f172a'
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
  const { showCorridors } = useSettings()
  const plotted = flights.filter(
    (f): f is NormalizedFlight & { lat: number; lon: number } =>
      f.lat != null && f.lon != null,
  )
  const points: L.LatLngExpression[] = [
    [pos.lat, pos.lon],
    ...plotted.map((f) => [f.lat, f.lon] as L.LatLngExpression),
  ]

  const corridorKinds = showCorridors
    ? (Array.from(new Set(CORRIDORS.map((c) => c.kind))) as CorridorKind[])
    : []

  return (
    <div className="relative h-[55vh] overflow-hidden rounded-xl border border-slate-700">
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
        {showCorridors && <CorridorOverlay />}
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
            icon={planeIcon(
              f.track,
              f.hex === selectedHex,
              topSeverity(assessFlight(f).flags) === 'breach',
            )}
            zIndexOffset={f.hex === selectedHex ? 1000 : 0}
            eventHandlers={{ click: () => onSelect(f) }}
          />
        ))}
        <FitBounds points={points} />
      </MapContainer>
      {corridorKinds.length > 0 && (
        <div className="pointer-events-none absolute bottom-2 left-2 z-[500] rounded-lg bg-slate-900/80 px-2 py-1.5 text-[10px] text-slate-200 backdrop-blur">
          <div className="mb-0.5 font-semibold uppercase tracking-wide text-slate-400">Corridors</div>
          {corridorKinds.map((k) => (
            <div key={k} className="flex items-center gap-1.5">
              <span
                className="inline-block h-2 w-3 rounded-sm"
                style={{ backgroundColor: CORRIDOR_COLOUR[k] }}
              />
              <span className="capitalize">{k}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
