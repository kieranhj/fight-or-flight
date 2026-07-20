import { useEffect, useMemo, useRef, useState } from 'react'
import { MapContainer, TileLayer, Marker, Polyline, CircleMarker } from 'react-leaflet'
import type { LatLngExpression } from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { fetchDayTrack, positionsAt, type ReplayData, type ReplayPosition } from '../lib/replay'
import type { NormalizedFlight } from '../lib/adsb'
import { aircraftIcon, CorridorOverlay } from './MapView'
import { useSettings } from './SettingsContext'
import { formatAltitudeFt, formatSpeed } from '../lib/format'

// Day replay (Phase H4): scrub through a recorded day, animating every captured
// aircraft on the map with short trails. All times UK.

const UK_TIME = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/London',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
})

/** Replay-minutes advanced per real second while playing. */
const SPEEDS = [1, 5, 15] as const

/** Adapt a replay position to the shape aircraftIcon() expects. */
function toFlightish(p: ReplayPosition): NormalizedFlight {
  return {
    hex: p.ac.hex,
    callsign: p.ac.callsign,
    registration: p.ac.reg,
    type: p.ac.type,
    category: p.ac.category,
    altBaroFt: p.altFt,
    altGeomFt: null,
    groundSpeedKt: p.groundSpeedKt,
    track: p.track,
    verticalRateFpm: null,
    navAltitudeFt: null,
    lat: p.lat,
    lon: p.lon,
    squawk: null,
    distanceNm: null,
    bearingDeg: null,
    onGround: p.onGround,
    military: p.ac.military,
    route: null,
  }
}

export default function ReplayView({ day }: { day: string }) {
  const settings = useSettings()
  const { showCorridors } = settings
  const [data, setData] = useState<ReplayData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [playhead, setPlayhead] = useState<number | null>(null)
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState<(typeof SPEEDS)[number]>(5)
  const [selectedHex, setSelectedHex] = useState<string | null>(null)

  useEffect(() => {
    let stale = false
    setData(null)
    setError(null)
    setPlaying(false)
    setPlayhead(null)
    fetchDayTrack(day)
      .then((d) => {
        if (stale) return
        setData(d)
        // Default playhead: noon UTC when the day covers it, else the range end
        // (for today that's "just now" — usually what you came to look at).
        const noon = Math.floor(Date.parse(`${day}T12:00:00Z`) / 1000)
        setPlayhead(noon >= d.minTs && noon <= d.maxTs ? noon : d.maxTs)
      })
      .catch((e) => !stale && setError(e instanceof Error ? e.message : String(e)))
    return () => {
      stale = true
    }
  }, [day])

  // Play loop: advance the playhead by `speed` replay-minutes per real second.
  const playheadRef = useRef(playhead)
  playheadRef.current = playhead
  useEffect(() => {
    if (!playing || !data) return
    const TICK_MS = 250
    const id = setInterval(() => {
      const cur = playheadRef.current ?? data.minTs
      const next = cur + speed * 60 * (TICK_MS / 1000)
      if (next >= data.maxTs) {
        setPlayhead(data.maxTs)
        setPlaying(false)
      } else setPlayhead(next)
    }, TICK_MS)
    return () => clearInterval(id)
  }, [playing, speed, data])

  const positions = useMemo(
    () => (data && playhead != null ? positionsAt(data, playhead) : []),
    [data, playhead],
  )
  const selected = selectedHex ? (positions.find((p) => p.ac.hex === selectedHex) ?? null) : null

  if (error) {
    return (
      <p className="rounded-lg border border-rose-500/40 bg-rose-500/10 p-3 text-sm text-rose-300">
        {error}
      </p>
    )
  }
  if (!data || playhead == null) {
    return (
      <p className="p-3 text-center text-sm text-slate-400">
        Loading the day's tracks… (a few MB on first view)
      </p>
    )
  }

  const home: LatLngExpression = [settings.homeLat, settings.homeLon]
  return (
    <div className="space-y-2.5">
      <div className="relative h-[46vh] overflow-hidden rounded-xl border border-slate-700">
        <MapContainer
          center={home}
          zoom={10}
          scrollWheelZoom
          style={{ height: '100%', width: '100%', background: '#0f172a' }}
        >
          <TileLayer
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
            maxZoom={19}
          />
          <CorridorOverlay show={showCorridors} />
          <CircleMarker
            center={home}
            radius={5}
            pathOptions={{ color: '#0ea5e9', fillColor: '#0ea5e9', fillOpacity: 0.9 }}
          />
          {positions.map((p) => (
            <Polyline
              key={`t-${p.ac.hex}`}
              positions={p.trail}
              pathOptions={{
                color: p.ac.hex === selectedHex ? '#38bdf8' : '#64748b',
                weight: 1.5,
                opacity: 0.55,
                interactive: false,
              }}
            />
          ))}
          {positions.map((p) => (
            <Marker
              key={p.ac.hex}
              position={[p.lat, p.lon]}
              icon={aircraftIcon(toFlightish(p), p.ac.hex === selectedHex, false)}
              zIndexOffset={p.ac.hex === selectedHex ? 1000 : 0}
              eventHandlers={{
                click: () => setSelectedHex(p.ac.hex === selectedHex ? null : p.ac.hex),
              }}
            />
          ))}
        </MapContainer>
        <div className="pointer-events-none absolute right-2 top-2 z-[1000] rounded-md bg-slate-900/80 px-2 py-1 text-xs font-semibold tabular-nums text-slate-100">
          {UK_TIME.format(new Date(playhead * 1000))} UK · {positions.length} aircraft
        </div>
      </div>

      {selected && (
        <div className="flex items-center justify-between gap-2 rounded-lg border border-sky-500/40 bg-sky-500/10 px-2.5 py-1.5 text-xs text-slate-200">
          <span className="min-w-0 truncate">
            <span className="font-bold">
              {selected.ac.callsign ?? selected.ac.reg ?? selected.ac.hex.toUpperCase()}
            </span>
            {selected.ac.type && ` · ${selected.ac.type}`}
            {selected.onGround
              ? ' · on ground'
              : ` · ${formatAltitudeFt(selected.altFt, settings.units.alt)}`}
            {selected.groundSpeedKt != null &&
              ` · ${formatSpeed(selected.groundSpeedKt, settings.units.speed)}`}
          </span>
          <button
            onClick={() => setSelectedHex(null)}
            className="shrink-0 font-semibold text-sky-400"
          >
            ✕
          </button>
        </div>
      )}

      <input
        type="range"
        aria-label="Replay time"
        min={data.minTs}
        max={data.maxTs}
        step={15}
        value={playhead}
        onChange={(e) => {
          setPlaying(false)
          setPlayhead(Number(e.target.value))
        }}
        className="w-full accent-sky-500"
      />

      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setPlaying((p) => !p)}
            className="rounded-lg bg-sky-500 px-4 py-1.5 text-sm font-semibold text-white"
          >
            {playing ? 'Pause' : 'Play'}
          </button>
          <div className="flex rounded-lg border border-slate-700 bg-slate-800/50 p-0.5 text-xs font-medium">
            {SPEEDS.map((s) => (
              <button
                key={s}
                onClick={() => setSpeed(s)}
                className={`rounded-md px-2 py-1 transition ${
                  speed === s ? 'bg-slate-600 text-white' : 'text-slate-400'
                }`}
              >
                {s}m/s
              </button>
            ))}
          </div>
        </div>
        <span className="text-[11px] tabular-nums text-slate-500">
          {UK_TIME.format(new Date(data.minTs * 1000))}–{UK_TIME.format(new Date(data.maxTs * 1000))}
          {' · '}
          {data.records.toLocaleString()} records
        </span>
      </div>

      <p className="text-[11px] leading-relaxed text-slate-500">
        Positions interpolated between 15 s samples; trails show the last 5 minutes. Tap an
        aircraft for its details at the playhead.
      </p>
    </div>
  )
}
