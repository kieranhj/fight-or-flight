import { useState } from 'react'
import { AIRPORT_LIST, HOME_LOCATION } from './config/airports'
import { INDICATIVE_DISCLAIMER } from './config/rules'
import { WORKER_BASE } from './config/api'
import { fetchNearby } from './lib/adsb'

type Probe =
  | { state: 'idle' }
  | { state: 'loading' }
  | { state: 'ok'; source: string; count: number }
  | { state: 'error'; message: string }

const CONSTRAINTS = [
  'Flags are indicative, not proof — operating hours are clear-cut, but altitude and track are approximations.',
  'The app cannot auto-submit to airport web forms; it prefills a message and hands off to you.',
  'Free ADS-B feeds have no uptime guarantee and can miss very low or masked aircraft.',
  'Data is used under each feed’s non-commercial terms, with attribution.',
]

export default function App() {
  const [probe, setProbe] = useState<Probe>({ state: 'idle' })

  async function checkWorker() {
    setProbe({ state: 'loading' })
    try {
      const res = await fetchNearby({ lat: HOME_LOCATION.lat, lon: HOME_LOCATION.lon })
      setProbe({ state: 'ok', source: res.source, count: res.flights.length })
    } catch (err) {
      setProbe({ state: 'error', message: err instanceof Error ? err.message : String(err) })
    }
  }

  return (
    <div className="min-h-full bg-slate-900 text-slate-100">
      <div className="mx-auto max-w-md px-4 py-6 pb-16">
        <header className="mb-6">
          <p className="text-xs font-semibold uppercase tracking-wider text-sky-400">
            Phase 0 · Scaffold
          </p>
          <h1 className="mt-1 text-2xl font-bold">Aircraft Complaint Assistant</h1>
          <p className="mt-2 text-sm text-slate-300">
            Identify the nearest aircraft, flag possible local-rule breaches, and prefill a
            complaint to the right authority.
          </p>
        </header>

        <section className="mb-6 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3">
          <h2 className="text-sm font-semibold text-amber-300">Indicative, not proof</h2>
          <p className="mt-1 text-xs leading-relaxed text-amber-100/90">{INDICATIVE_DISCLAIMER}</p>
        </section>

        <section className="mb-6">
          <h2 className="mb-2 text-sm font-semibold text-slate-200">Data path check</h2>
          <p className="mb-3 text-xs text-slate-400">
            The front-end talks only to the Cloudflare Worker. Worker base:{' '}
            <code className="break-all rounded bg-slate-800 px-1 py-0.5 text-[11px]">
              {WORKER_BASE}
            </code>
          </p>
          <button
            onClick={checkWorker}
            disabled={probe.state === 'loading'}
            className="w-full rounded-lg bg-sky-500 px-4 py-3 text-sm font-semibold text-white transition active:scale-[0.99] disabled:opacity-60"
          >
            {probe.state === 'loading' ? 'Checking Worker…' : 'Check Worker /api/nearby'}
          </button>
          <div className="mt-2 min-h-[1.25rem] text-xs" aria-live="polite">
            {probe.state === 'ok' && (
              <span className="text-emerald-400">
                Worker reachable — source “{probe.source}”, {probe.count} sample flight(s).
              </span>
            )}
            {probe.state === 'error' && (
              <span className="text-rose-400">Worker unreachable: {probe.message}</span>
            )}
            {probe.state === 'idle' && (
              <span className="text-slate-500">
                Stub returns hard-coded sample data in Phase 0.
              </span>
            )}
          </div>
        </section>

        <section className="mb-6">
          <h2 className="mb-2 text-sm font-semibold text-slate-200">Airports in scope</h2>
          <ul className="space-y-2">
            {AIRPORT_LIST.map((a) => (
              <li
                key={a.icao}
                className="rounded-lg border border-slate-700 bg-slate-800/50 p-3 text-sm"
              >
                <div className="flex items-baseline justify-between">
                  <span className="font-semibold">{a.name}</span>
                  <span className="font-mono text-xs text-slate-400">{a.icao}</span>
                </div>
                <div className="mt-1 text-xs text-slate-400">
                  {a.position.lat.toFixed(4)}, {a.position.lon.toFixed(4)} · weekend{' '}
                  {a.hours.weekend.open}–{a.hours.weekend.close}
                </div>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-slate-500">
            Home / GPS fallback: {HOME_LOCATION.label} ({HOME_LOCATION.lat}, {HOME_LOCATION.lon}).
          </p>
        </section>

        <section>
          <h2 className="mb-2 text-sm font-semibold text-slate-200">Honest constraints</h2>
          <ul className="space-y-1.5 text-xs text-slate-400">
            {CONSTRAINTS.map((c) => (
              <li key={c} className="flex gap-2">
                <span className="text-slate-600">•</span>
                <span>{c}</span>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  )
}
