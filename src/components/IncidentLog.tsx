import { useState } from 'react'
import {
  getIncidents,
  removeIncident,
  clearIncidents,
  incidentsToCsv,
  type Incident,
} from '../lib/log'
import { formatClock, formatAltitudeFt, formatDistance } from '../lib/format'
import { useSettings } from './SettingsContext'

function severityDot(sev: string): string {
  return sev === 'breach' ? 'bg-rose-500' : sev === 'info' ? 'bg-sky-500' : 'bg-amber-500'
}

function downloadCsv() {
  const blob = new Blob([incidentsToCsv()], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `fight-or-flight-incidents.csv`
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

export default function IncidentLog({
  onClose,
  onChange,
}: {
  onClose: () => void
  onChange?: () => void
}) {
  const [incidents, setIncidents] = useState<Incident[]>(() => getIncidents())
  const { units } = useSettings()

  function refresh() {
    setIncidents(getIncidents())
    onChange?.()
  }

  return (
    <div className="fixed inset-0 z-[1100] flex items-end justify-center bg-black/60" onClick={onClose}>
      <div
        className="max-h-[92vh] w-full max-w-md overflow-y-auto overscroll-contain rounded-t-2xl border-t border-slate-700 bg-slate-900 p-4 pb-8 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Incident log"
      >
        <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-slate-700" />
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="text-lg font-bold text-white">Incident log</h2>
          <button
            onClick={onClose}
            className="shrink-0 rounded-lg bg-slate-800 px-3 py-1.5 text-sm font-medium text-slate-300"
          >
            Close
          </button>
        </div>

        {incidents.length === 0 ? (
          <p className="rounded-lg border border-slate-700 bg-slate-800/40 p-4 text-center text-sm text-slate-400">
            No incidents logged yet. Generate a complaint from a flight and it’ll be saved here as
            your evidence base.
          </p>
        ) : (
          <>
            <div className="mb-3 flex gap-2">
              <button
                onClick={downloadCsv}
                className="flex-1 rounded-lg bg-sky-500 px-3 py-2.5 text-sm font-semibold text-white"
              >
                Export CSV ({incidents.length})
              </button>
              <button
                onClick={() => {
                  if (confirm('Clear all logged incidents? This cannot be undone.')) {
                    clearIncidents()
                    refresh()
                  }
                }}
                className="rounded-lg border border-slate-700 px-3 py-2.5 text-sm font-medium text-slate-300"
              >
                Clear all
              </button>
            </div>

            <ul className="space-y-2">
              {incidents.map((i) => (
                <li key={i.id} className="rounded-lg border border-slate-700 bg-slate-800/50 p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-semibold text-white">
                        {i.callsign ?? i.registration ?? i.hex?.toUpperCase() ?? 'Unknown'}
                        <span className="ml-2 text-xs font-normal text-slate-400">
                          {i.airportName ?? '—'}
                        </span>
                      </div>
                      <div className="mt-0.5 text-xs text-slate-400">
                        {new Date(i.loggedAt).toLocaleDateString()} {formatClock(i.loggedAt)} ·{' '}
                        {formatAltitudeFt(i.altitudeFt, units.alt)} ·{' '}
                        {formatDistance(i.distanceNm, units.dist)}
                      </div>
                      {i.flags.length > 0 && (
                        <div className="mt-1.5 flex flex-wrap gap-1.5">
                          {i.flags.map((f, idx) => (
                            <span
                              key={idx}
                              className="inline-flex items-center gap-1 text-[11px] text-slate-300"
                            >
                              <span className={`h-1.5 w-1.5 rounded-full ${severityDot(f.severity)}`} />
                              {f.short}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                    <button
                      onClick={() => {
                        removeIncident(i.id)
                        refresh()
                      }}
                      aria-label="Delete incident"
                      className="shrink-0 rounded-md px-2 py-1 text-slate-500 hover:text-rose-400"
                    >
                      ✕
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </div>
  )
}
