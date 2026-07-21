import { useEffect, useMemo, useRef, useState } from 'react'
import { MapContainer, TileLayer, Marker, Polyline, CircleMarker } from 'react-leaflet'
import type { LatLngExpression } from 'leaflet'
import 'leaflet/dist/leaflet.css'
import {
  fetchDayTrack,
  positionsAt,
  type ReplayData,
  type ReplayGroup,
  type ReplayPosition,
} from '../lib/replay'
import { fetchRoute, type FlightRoute, type NormalizedFlight } from '../lib/adsb'
import { aircraftIcon, CorridorOverlay } from './MapView'
import FlightDetail from './FlightDetail'
import { useSettings } from './SettingsContext'
import { haversineNm, bearingDeg } from '../lib/geo'

// Day replay (Phase H4): scrub through a recorded day, animating every captured
// aircraft on the map with short trails. All times UK.

const UK_TIME = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/London',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
})

/** Playback speeds: replay-minutes advanced per real second. Anything faster is
 * better served by scrubbing the slider. */
const SPEEDS = [
  { label: '10s/s', mps: 1 / 6 },
  { label: '30s/s', mps: 0.5 },
  { label: '1m/s', mps: 1 },
] as const

const GROUP_LABEL: Record<ReplayGroup, string> = {
  EGLF: 'Farnborough',
  EGLK: 'Blackbushe',
  EGLL: 'Heathrow',
  EGKK: 'Gatwick',
  low: 'Other low',
  transit: 'Transit',
}
const GROUP_ORDER: ReplayGroup[] = ['EGLF', 'EGLK', 'EGLL', 'EGKK', 'low', 'transit']

/** Adapt a replay position to a NormalizedFlight (icons + the full flight card).
 * Distance/bearing are from home — the replay's fixed vantage point. */
function toFlightish(
  p: ReplayPosition,
  home: { lat: number; lon: number },
  route: FlightRoute | null = null,
): NormalizedFlight {
  const pos = { lat: p.lat, lon: p.lon }
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
    verticalRateFpm: p.verticalRateFpm,
    navAltitudeFt: p.navAltitudeFt,
    lat: p.lat,
    lon: p.lon,
    squawk: p.ac.squawk,
    distanceNm: Math.round(haversineNm(pos, home) * 10) / 10,
    bearingDeg: Math.round(bearingDeg(home, pos)),
    onGround: p.onGround,
    military: p.ac.military,
    route,
  }
}

export default function ReplayView({
  day,
  initialAt = null,
}: {
  day: string
  /** Open with the playhead here (epoch s) — e.g. jumping from a flagged flight. */
  initialAt?: number | null
}) {
  const settings = useSettings()
  const { showCorridors } = settings
  const [data, setData] = useState<ReplayData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [playhead, setPlayhead] = useState<number | null>(null)
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState<(typeof SPEEDS)[number]['mps']>(1)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [groups, setGroups] = useState<ReadonlySet<ReplayGroup>>(new Set(GROUP_ORDER))
  // Route lookups for opened cards, memoized per callsign for the session.
  const routesRef = useRef(new Map<string, FlightRoute | null>())
  const [routeTick, setRouteTick] = useState(0)

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
        // Default playhead: the requested jump moment when given, else noon UTC
        // when the day covers it, else the range end (for today: "just now").
        const noon = Math.floor(Date.parse(`${day}T12:00:00Z`) / 1000)
        const want =
          initialAt != null && initialAt >= d.minTs && initialAt <= d.maxTs ? initialAt : null
        setPlayhead(want ?? (noon >= d.minTs && noon <= d.maxTs ? noon : d.maxTs))
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
    () => (data && playhead != null ? positionsAt(data, playhead, groups) : []),
    [data, playhead, groups],
  )
  const selected = selectedId ? (positions.find((p) => p.ac.id === selectedId) ?? null) : null

  // Fetch the selected aircraft's route (origin/destination) once per callsign.
  const selectedCallsign = selected?.ac.callsign ?? null
  useEffect(() => {
    if (!selectedCallsign || routesRef.current.has(selectedCallsign)) return
    let stale = false
    fetchRoute(selectedCallsign)
      .then((route) => {
        if (stale) return
        routesRef.current.set(selectedCallsign, route)
        setRouteTick((n) => n + 1)
      })
      .catch(() => {
        /* card just shows no route */
      })
    return () => {
      stale = true
    }
  }, [selectedCallsign])
  void routeTick // re-render trigger for the card below

  function toggleGroup(g: ReplayGroup) {
    setGroups((prev) => {
      const next = new Set(prev)
      if (next.has(g)) next.delete(g)
      else next.add(g)
      return next
    })
  }

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
  const homePos = { lat: settings.homeLat, lon: settings.homeLon }
  return (
    <div className="space-y-2.5">
      {/* Group filters — counts are aircraft over the whole day. */}
      <div className="flex flex-wrap gap-1.5">
        {GROUP_ORDER.map((g) => {
          const on = groups.has(g)
          return (
            <button
              key={g}
              onClick={() => toggleGroup(g)}
              aria-pressed={on}
              className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold transition ${
                on
                  ? 'border-sky-500/60 bg-sky-500/15 text-sky-200'
                  : 'border-slate-700 bg-slate-800/40 text-slate-500'
              }`}
            >
              {GROUP_LABEL[g]} ({data.groupCounts[g]})
            </button>
          )
        })}
      </div>

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
              key={`t-${p.ac.id}`}
              positions={p.trail}
              pathOptions={{
                color: p.ac.id === selectedId ? '#38bdf8' : '#64748b',
                weight: 1.5,
                opacity: 0.55,
                interactive: false,
              }}
            />
          ))}
          {positions.map((p) => (
            <Marker
              key={p.ac.id}
              position={[p.lat, p.lon]}
              icon={aircraftIcon(toFlightish(p, homePos), p.ac.id === selectedId, false)}
              zIndexOffset={p.ac.id === selectedId ? 1000 : 0}
              eventHandlers={{
                click: () => {
                  setPlaying(false)
                  setSelectedId(p.ac.id)
                },
              }}
            />
          ))}
        </MapContainer>
        <div className="pointer-events-none absolute right-2 top-2 z-[1000] rounded-md bg-slate-900/80 px-2 py-1 text-xs font-semibold tabular-nums text-slate-100">
          {UK_TIME.format(new Date(playhead * 1000))} UK · {positions.length} aircraft
        </div>
      </div>

      {selected && playhead != null && (
        <FlightDetail
          flight={toFlightish(
            selected,
            homePos,
            selected.ac.callsign ? (routesRef.current.get(selected.ac.callsign) ?? null) : null,
          )}
          when={new Date(playhead * 1000)}
          zClass="z-[1300]"
          onClose={() => setSelectedId(null)}
        />
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
                key={s.label}
                onClick={() => setSpeed(s.mps)}
                className={`rounded-md px-2 py-1 transition ${
                  speed === s.mps ? 'bg-slate-600 text-white' : 'text-slate-400'
                }`}
              >
                {s.label}
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
