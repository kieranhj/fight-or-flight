import { useEffect, useMemo, useRef, useState } from 'react'
import NearbyButton, { type NearbyStatus } from './components/NearbyButton'
import FlightList from './components/FlightList'
import MapView from './components/MapView'
import FlightDetail from './components/FlightDetail'
import ComplaintModal from './components/ComplaintModal'
import IncidentLog from './components/IncidentLog'
import ReviewModal from './components/ReviewModal'
import HistoryModal from './components/HistoryModal'
import SettingsModal from './components/SettingsModal'
import type { ReviewRecord } from './lib/incidentCsv'
import { SettingsContext } from './components/SettingsContext'
import { fetchNearby, type NearbyResponse, type NormalizedFlight } from './lib/adsb'
import { getCurrentPosition, type GeoResult } from './lib/geolocation'
import { classifyFlight } from './lib/classify'
import { incidentCount } from './lib/log'
import { loadSettings, saveSettings, type Settings } from './lib/settings'

const CONSTRAINTS = [
  'Telemetry comes from free, volunteer ADS-B feeds — no uptime guarantee, and very low or masked aircraft can be missed.',
  'By default the list shows airborne fixed-wing jets — military, helicopters and light aircraft are filtered out (toggle them on in settings); on-ground traffic is always removed.',
  'Flags are indicative, not proof — operating hours are clear-cut, but altitude and track use approximations and aircraft on approach are legitimately low. Always review before acting.',
]

type View = 'list' | 'map'

/** Max positions kept per aircraft trail (e.g. 15 × 10s ≈ 2.5 min of track). */
const TRAIL_MAX = 15

function useOnline(): boolean {
  const [online, setOnline] = useState(() => navigator.onLine)
  useEffect(() => {
    const on = () => setOnline(true)
    const off = () => setOnline(false)
    window.addEventListener('online', on)
    window.addEventListener('offline', off)
    return () => {
      window.removeEventListener('online', on)
      window.removeEventListener('offline', off)
    }
  }, [])
  return online
}

export default function App() {
  const [settings, setSettings] = useState<Settings>(() => loadSettings())
  const [status, setStatus] = useState<NearbyStatus>('idle')
  const [result, setResult] = useState<NearbyResponse | null>(null)
  const [pos, setPos] = useState<GeoResult | null>(null)
  const [homeUsed, setHomeUsed] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [view, setView] = useState<View>('list')
  const [selected, setSelected] = useState<NormalizedFlight | null>(null)
  const [complaintFor, setComplaintFor] = useState<NormalizedFlight | null>(null)
  const [showLog, setShowLog] = useState(false)
  const [showHistory, setShowHistory] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [review, setReview] = useState<{ records: ReviewRecord[]; title: string } | null>(null)
  const [logCount, setLogCount] = useState(() => incidentCount())
  const [trails, setTrails] = useState<Record<string, [number, number][]>>({})
  const [refreshing, setRefreshing] = useState(false)
  const abortRef = useRef<AbortController | null>(null)
  const posRef = useRef<GeoResult | null>(null)
  const online = useOnline()

  function updateSettings(s: Settings) {
    setSettings(s)
    saveSettings(s)
  }

  async function resolvePosition(): Promise<{ pos: GeoResult; home: boolean }> {
    const homePos: GeoResult = { lat: settings.homeLat, lon: settings.homeLon, accuracyM: 0 }
    if (settings.locationMode === 'home') return { pos: homePos, home: true }
    try {
      return { pos: await getCurrentPosition(), home: false }
    } catch (err) {
      if (settings.homeFallback) return { pos: homePos, home: true }
      throw err
    }
  }

  // Append current positions to each aircraft's trail; prune aircraft now absent.
  function applyResult(res: NearbyResponse) {
    setResult(res)
    setTrails((prev) => {
      const next: Record<string, [number, number][]> = {}
      for (const f of res.flights) {
        if (!f.hex || f.lat == null || f.lon == null) continue
        const t = prev[f.hex] ?? []
        const last = t[t.length - 1]
        const moved = !last || last[0] !== f.lat || last[1] !== f.lon
        next[f.hex] = (moved ? [...t, [f.lat, f.lon] as [number, number]] : t).slice(-TRAIL_MAX)
      }
      return next
    })
  }

  async function runFetch(p: GeoResult, auto: boolean) {
    abortRef.current?.abort()
    const ac = new AbortController()
    abortRef.current = ac
    if (auto) setRefreshing(true)
    else setStatus('loading')
    try {
      const res = await fetchNearby({
        lat: p.lat,
        lon: p.lon,
        radiusNm: settings.radiusNm,
        n: settings.n,
        include: settings.include,
        signal: ac.signal,
      })
      if (ac.signal.aborted) return
      applyResult(res)
      setStatus('ready')
    } catch (err) {
      if (ac.signal.aborted) return
      // Auto-refresh failures keep the last good result on screen, silently.
      if (!auto) {
        setError(err instanceof Error ? err.message : String(err))
        setStatus('error')
      }
    } finally {
      if (auto) setRefreshing(false)
    }
  }

  async function identify() {
    setError(null)
    setSelected(null)
    if (!online) {
      setError('You’re offline. Reconnect to fetch live aircraft.')
      setStatus('error')
      return
    }
    setStatus('locating')
    try {
      const { pos: p, home } = await resolvePosition()
      setPos(p)
      posRef.current = p
      setHomeUsed(home)
      setTrails({}) // fresh start for a new identify
      await runFetch(p, false)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setStatus('error')
    }
  }

  // Auto-refresh loop: re-fetch on an interval, paused when hidden/offline.
  const runFetchRef = useRef(runFetch)
  runFetchRef.current = runFetch
  useEffect(() => {
    if (!settings.autoRefresh) return
    const id = setInterval(
      () => {
        if (document.hidden || !navigator.onLine) return
        const p = posRef.current
        if (p) runFetchRef.current(p, true)
      },
      Math.max(5, settings.autoRefreshSec) * 1000,
    )
    return () => clearInterval(id)
  }, [settings.autoRefresh, settings.autoRefreshSec])

  const hasResults = result != null && status !== 'error'

  // Client-side display filter by classification group (the nearest-N are fetched
  // first, then filtered here).
  const visibleFlights = useMemo(
    () => (result ? result.flights.filter((f) => settings.showGroups[classifyFlight(f).group]) : []),
    [result, settings.showGroups],
  )
  const hiddenCount = (result?.flights.length ?? 0) - visibleFlights.length

  return (
    <SettingsContext.Provider value={settings}>
      <div className="min-h-full bg-slate-900 text-slate-100">
        {!online && (
          <div className="bg-amber-500/90 px-4 py-1.5 text-center text-xs font-semibold text-slate-900">
            You’re offline — showing the cached app; live data needs a connection.
          </div>
        )}
        <div className="mx-auto flex min-h-full max-w-md flex-col px-4 py-6">
          <header className="mb-5 flex items-start justify-between gap-3">
            <div>
              <h1 className="text-xl font-bold">Fight or Flight</h1>
              <p className="mt-1 text-sm text-slate-400">
                Tap to see the aircraft overhead and their telemetry.
              </p>
            </div>
            <div className="flex shrink-0 gap-2">
              <button
                onClick={() => setShowLog(true)}
                className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs font-medium text-slate-300"
              >
                Log{logCount > 0 ? ` (${logCount})` : ''}
              </button>
              <button
                onClick={() => setShowHistory(true)}
                className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs font-medium text-slate-300"
              >
                History
              </button>
              <button
                onClick={() => setShowSettings(true)}
                aria-label="Settings"
                className="rounded-lg border border-slate-700 px-2.5 py-1.5 text-xs font-medium text-slate-300"
              >
                ⚙
              </button>
            </div>
          </header>

          <NearbyButton status={status} onClick={identify} />

          <div className="mt-3 min-h-[1.25rem] text-center text-sm" aria-live="polite">
            {status === 'locating' && (
              <span className="text-slate-400">Getting your location…</span>
            )}
            {status === 'loading' && <span className="text-slate-400">Finding nearby aircraft…</span>}
            {status === 'error' && error && <span className="text-rose-400">{error}</span>}
            {status === 'idle' && (
              <span className="text-slate-500">
                {settings.locationMode === 'home'
                  ? 'Uses your saved home location.'
                  : 'Uses your device location; nothing is stored.'}
              </span>
            )}
          </div>

          {hasResults && (
            <div className="mt-4 flex rounded-lg border border-slate-700 bg-slate-800/50 p-1 text-sm font-medium">
              {(['list', 'map'] as const).map((v) => (
                <button
                  key={v}
                  onClick={() => setView(v)}
                  className={`flex-1 rounded-md py-1.5 capitalize transition ${
                    view === v ? 'bg-sky-500 text-white' : 'text-slate-400'
                  }`}
                >
                  {v}
                </button>
              ))}
            </div>
          )}

          {hasResults && settings.autoRefresh && (
            <p className="mt-2 text-center text-[11px] text-slate-500">
              <span
                className={`mr-1.5 inline-block h-1.5 w-1.5 rounded-full align-middle ${
                  refreshing ? 'animate-pulse bg-emerald-400' : 'bg-slate-600'
                }`}
              />
              Auto-refreshing every {settings.autoRefreshSec}s
            </p>
          )}

          <main className="mt-4 flex-1">
            {hasResults && view === 'list' && (
              <FlightList
                result={{ ...result, flights: visibleFlights }}
                hiddenCount={hiddenCount}
                accuracyM={homeUsed ? undefined : pos?.accuracyM}
                onSelect={setSelected}
              />
            )}
            {hasResults && view === 'map' && pos && (
              <MapView
                pos={pos}
                flights={visibleFlights}
                trails={trails}
                selectedHex={selected?.hex ?? null}
                onSelect={setSelected}
              />
            )}
          </main>

          <footer className="mt-8 border-t border-slate-800 pt-4">
            <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
              Good to know
            </h2>
            <ul className="space-y-1.5 text-[11px] leading-relaxed text-slate-500">
              {CONSTRAINTS.map((c) => (
                <li key={c} className="flex gap-2">
                  <span className="text-slate-600">•</span>
                  <span>{c}</span>
                </li>
              ))}
            </ul>
            <p className="mt-3 text-[11px] text-slate-600">
              Aircraft data via airplanes.live / adsb.lol; routes via hexdb.io; map © OpenStreetMap
              contributors. Used under their terms.
            </p>
          </footer>
        </div>

        {selected && (
          <FlightDetail
            flight={selected}
            onClose={() => setSelected(null)}
            onComplain={(f) => {
              setSelected(null)
              setComplaintFor(f)
            }}
          />
        )}

        {complaintFor && (
          <ComplaintModal
            flight={complaintFor}
            observedAt={result?.generatedAt ?? Date.now()}
            onClose={() => setComplaintFor(null)}
            onLogged={() => setLogCount(incidentCount())}
          />
        )}

        {showLog && (
          <IncidentLog
            onClose={() => setShowLog(false)}
            onChange={() => setLogCount(incidentCount())}
            onReview={(records, title) => setReview({ records, title })}
          />
        )}

        {review && (
          <ReviewModal
            records={review.records}
            title={review.title}
            onClose={() => setReview(null)}
          />
        )}

        {showHistory && <HistoryModal onClose={() => setShowHistory(false)} />}

        {showSettings && (
          <SettingsModal
            settings={settings}
            onChange={updateSettings}
            onClose={() => setShowSettings(false)}
          />
        )}
      </div>
    </SettingsContext.Provider>
  )
}
