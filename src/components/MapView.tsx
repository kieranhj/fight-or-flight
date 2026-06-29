import { Fragment, useEffect, useRef } from 'react'
import { MapContainer, TileLayer, Marker, Circle, Polygon, Polyline, useMap } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import type { NormalizedFlight } from '../lib/adsb'
import type { GeoResult } from '../lib/geolocation'
import { assessFlight, topSeverity } from '../lib/assess'
import { aircraftKind } from '../lib/aircraft'
import { useSettings } from './SettingsContext'
import { CORRIDORS, type CorridorKind } from '../config/corridors'

// Corridor overlay colours, keyed by type.
const CORRIDOR_COLOUR: Record<CorridorKind, string> = {
  departure: '#f59e0b', // amber
  arrival: '#2dd4bf', // teal
}

// Draw the real WebTrak swath polygons for the enabled kinds. The lateral
// "Corridors" SID/STAR envelopes get a firmer outline; the broader altitude-band
// zones a fainter wash.
function CorridorOverlay({ show }: { show: Record<CorridorKind, boolean> }) {
  return (
    <>
      {CORRIDORS.filter((c) => show[c.kind]).map((c) => {
        const colour = CORRIDOR_COLOUR[c.kind]
        const lateral = c.group === 'Corridors'
        const positions = c.polygon.map((p) => [p.lat, p.lon] as L.LatLngExpression)
        return (
          <Polygon
            key={c.id}
            positions={positions}
            pathOptions={{
              color: colour,
              weight: lateral ? 1.5 : 1,
              opacity: lateral ? 0.7 : 0.35,
              fillColor: colour,
              fillOpacity: lateral ? 0.12 : 0.06,
              interactive: false,
            }}
          />
        )
      })}
    </>
  )
}

// Aircraft glyph points north (up) at 0°; we rotate it by the flight's track.
const PLANE_PATH =
  'M12 2 L13.4 11 L21 15 L21 17 L13.4 14.6 L13 20 L16 22 L16 23 L12 21.8 L8 23 L8 22 L11 20 L10.6 14.6 L3 17 L3 15 L10.6 11 Z'
const LIGHT_PATH =
  'M12 3 L12.8 10 L19 13 L19 14.5 L12.8 12.8 L12.5 18 L15 19.5 L15 20.5 L12 19.6 L9 20.5 L9 19.5 L11.5 18 L11.2 12.8 L5 14.5 L5 13 L11.2 10 Z'

// Aircraft marker. Shape encodes kind (helicopter glyph vs plane, plane sized by
// class); colour encodes status: selected (sky) > breach (rose) > military
// (orange) > slate. Glyph points north and is rotated to the flight's track.
function aircraftIcon(f: NormalizedFlight, selected: boolean, breach: boolean): L.DivIcon {
  const kind = aircraftKind(f)
  const fill = selected
    ? '#38bdf8'
    : breach
      ? '#fb7185'
      : kind === 'military'
        ? '#fb923c'
        : '#e2e8f0'
  const stroke = selected ? '#0c4a6e' : breach ? '#7f1d1d' : '#0f172a'
  const rot = f.track ?? 0
  const SIZE: Partial<Record<typeof kind, number>> = {
    light: 22,
    'small-jet': 24,
    'fast-jet': 24,
    'medium-jet': 27,
    'large-jet': 30,
    'heavy-jet': 33,
  }
  const size = SIZE[kind] ?? 26

  let glyph: string
  if (kind === 'helicopter') {
    // Rotor disc + hub + tail boom (front = top), rotated to track.
    glyph = `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${fill}" stroke-width="1.6" stroke-linecap="round">
        <circle cx="12" cy="10" r="6.5" stroke-opacity="0.8"/>
        <circle cx="12" cy="10" r="1.8" fill="${fill}" stroke="${stroke}" stroke-width="0.6"/>
        <line x1="12" y1="11.5" x2="12" y2="21"/>
        <line x1="9" y1="21" x2="15" y2="21"/>
      </svg>`
  } else {
    const path = kind === 'light' ? LIGHT_PATH : PLANE_PATH
    glyph = `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="${fill}" stroke="${stroke}" stroke-width="1" stroke-linejoin="round"><path d="${path}"/></svg>`
  }

  return L.divIcon({
    html: `<div style="transform: rotate(${rot}deg); width:${size}px; height:${size}px; display:flex; align-items:center; justify-content:center;">${glyph}</div>`,
    className: 'plane-marker',
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  })
}

const userIcon = L.divIcon({
  html: `<div style="width:16px;height:16px;border-radius:50%;background:#0ea5e9;border:3px solid #fff;box-shadow:0 0 0 2px rgba(14,165,233,0.5);"></div>`,
  className: 'user-marker',
  iconSize: [16, 16],
  iconAnchor: [8, 8],
})

/**
 * Fit the map to show the user plus all plotted aircraft. Always frames once (the
 * initial render); thereafter only re-frames on refresh when `recenter` is on, so
 * turning it off preserves the user's pan/zoom.
 */
function FitBounds({ points, recenter }: { points: L.LatLngExpression[]; recenter: boolean }) {
  const map = useMap()
  const hasFit = useRef(false)
  useEffect(() => {
    if (points.length === 0) return
    if (!recenter && hasFit.current) return
    if (points.length === 1) map.setView(points[0], 12)
    else map.fitBounds(L.latLngBounds(points), { padding: [40, 40], maxZoom: 13 })
    hasFit.current = true
  }, [points, map, recenter])
  return null
}

export default function MapView({
  pos,
  flights,
  trails = {},
  selectedHex,
  onSelect,
}: {
  pos: GeoResult
  flights: NormalizedFlight[]
  trails?: Record<string, [number, number][]>
  selectedHex: string | null
  onSelect: (f: NormalizedFlight) => void
}) {
  const { showCorridors, recenterOnRefresh } = useSettings()
  const plotted = flights.filter(
    (f): f is NormalizedFlight & { lat: number; lon: number } =>
      f.lat != null && f.lon != null,
  )
  const points: L.LatLngExpression[] = [
    [pos.lat, pos.lon],
    ...plotted.map((f) => [f.lat, f.lon] as L.LatLngExpression),
  ]

  const anyCorridor = showCorridors.departure || showCorridors.arrival
  const corridorKinds = (
    Array.from(new Set(CORRIDORS.map((c) => c.kind))) as CorridorKind[]
  ).filter((k) => showCorridors[k])

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
        {anyCorridor && <CorridorOverlay show={showCorridors} />}
        <Circle
          center={[pos.lat, pos.lon]}
          radius={pos.accuracyM}
          pathOptions={{ color: '#0ea5e9', weight: 1, fillColor: '#0ea5e9', fillOpacity: 0.1 }}
        />
        <Marker position={[pos.lat, pos.lon]} icon={userIcon} />
        {plotted.map((f) => {
          const breach = topSeverity(assessFlight(f).flags) === 'breach'
          const trail = f.hex ? trails[f.hex] : undefined
          return (
            <Fragment key={f.hex || `${f.callsign}-${f.lat}-${f.lon}`}>
              {trail && trail.length >= 2 && (
                <Polyline
                  positions={trail}
                  pathOptions={{
                    color: breach ? '#fb7185' : '#94a3b8',
                    weight: 2,
                    opacity: 0.55,
                    interactive: false,
                  }}
                />
              )}
              <Marker
                position={[f.lat, f.lon]}
                icon={aircraftIcon(f, f.hex === selectedHex, breach)}
                zIndexOffset={f.hex === selectedHex ? 1000 : 0}
                eventHandlers={{ click: () => onSelect(f) }}
              />
            </Fragment>
          )
        })}
        <FitBounds points={points} recenter={recenterOnRefresh} />
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
