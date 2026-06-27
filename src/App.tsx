import { useRef, useState } from 'react'
import NearbyButton, { type NearbyStatus } from './components/NearbyButton'
import FlightList from './components/FlightList'
import MapView from './components/MapView'
import FlightDetail from './components/FlightDetail'
import { fetchNearby, type NearbyResponse, type NormalizedFlight } from './lib/adsb'
import { getCurrentPosition, type GeoResult } from './lib/geolocation'

const CONSTRAINTS = [
  'Telemetry comes from free, volunteer ADS-B feeds — no uptime guarantee, and very low or masked aircraft can be missed.',
  'The list is filtered to airborne fixed-wing jets; military, rotorcraft, light GA and on-ground traffic are removed.',
  'Rule flags (which airport, possible breaches) arrive in later phases — this phase just identifies what’s overhead.',
]

type View = 'list' | 'map'

export default function App() {
  const [status, setStatus] = useState<NearbyStatus>('idle')
  const [result, setResult] = useState<NearbyResponse | null>(null)
  const [pos, setPos] = useState<GeoResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [view, setView] = useState<View>('list')
  const [selected, setSelected] = useState<NormalizedFlight | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  async function identify() {
    abortRef.current?.abort()
    const ac = new AbortController()
    abortRef.current = ac
    setError(null)
    setSelected(null)
    setStatus('locating')
    try {
      const p = await getCurrentPosition()
      setPos(p)
      setStatus('loading')
      const res = await fetchNearby({ lat: p.lat, lon: p.lon, signal: ac.signal })
      if (ac.signal.aborted) return
      setResult(res)
      setStatus('ready')
    } catch (err) {
      if (ac.signal.aborted) return
      setError(err instanceof Error ? err.message : String(err))
      setStatus('error')
    }
  }

  const hasResults = result != null && status !== 'error'

  return (
    <div className="min-h-full bg-slate-900 text-slate-100">
      <div className="mx-auto flex min-h-full max-w-md flex-col px-4 py-6">
        <header className="mb-5">
          <h1 className="text-xl font-bold">Aircraft Complaint Assistant</h1>
          <p className="mt-1 text-sm text-slate-400">
            Tap to see the aircraft overhead and their telemetry.
          </p>
        </header>

        <NearbyButton status={status} onClick={identify} />

        <div className="mt-3 min-h-[1.25rem] text-center text-sm" aria-live="polite">
          {status === 'locating' && <span className="text-slate-400">Getting your location…</span>}
          {status === 'loading' && (
            <span className="text-slate-400">Finding nearby aircraft…</span>
          )}
          {status === 'error' && error && <span className="text-rose-400">{error}</span>}
          {status === 'idle' && (
            <span className="text-slate-500">Uses your device location; nothing is stored.</span>
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

        <main className="mt-4 flex-1">
          {hasResults && view === 'list' && (
            <FlightList result={result} accuracyM={pos?.accuracyM} onSelect={setSelected} />
          )}
          {hasResults && view === 'map' && pos && (
            <MapView
              pos={pos}
              flights={result.flights}
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
            Data via airplanes.live / adsb.lol; map © OpenStreetMap contributors. Used under their
            terms.
          </p>
        </footer>
      </div>

      {selected && <FlightDetail flight={selected} onClose={() => setSelected(null)} />}
    </div>
  )
}
