import { useMemo, useState } from 'react'
import type { ReviewRecord } from '../lib/incidentCsv'
import { buildReviewItems, type ReviewItem } from '../lib/review'
import { flightTitle, formatAltitude, formatDistance, formatClock } from '../lib/format'
import { useSettings } from './SettingsContext'
import AirportTag from './AirportTag'
import FlagBadge from './FlagBadge'
import KindTag from './KindTag'
import ReviewMap from './ReviewMap'
import ReviewDetail from './ReviewDetail'

type View = 'list' | 'map'

function Rows({ items, onSelect }: { items: ReviewItem[]; onSelect: (it: ReviewItem) => void }) {
  const { units } = useSettings()
  return (
    <ul className="space-y-2">
      {items.map((it) => {
        const { flight, assessment, record } = it
        const when = record.observedAt ?? record.loggedAt
        return (
          <li
            key={record.id}
            onClick={() => onSelect(it)}
            className="cursor-pointer rounded-xl border border-slate-700 bg-slate-800/60 p-3 transition active:scale-[0.99] hover:border-slate-600"
          >
            <div className="flex items-baseline justify-between gap-2">
              <div className="truncate text-base font-bold text-white">{flightTitle(flight)}</div>
              <div className="shrink-0 text-xs text-slate-400">
                {when != null ? `${new Date(when).toLocaleDateString()} ${formatClock(when)}` : '—'}
              </div>
            </div>
            <div className="truncate text-xs text-slate-400">
              {[flight.type, record.airportName].filter(Boolean).join(' · ') || '—'}
            </div>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              <KindTag flight={flight} />
              <AirportTag classification={assessment.classification} />
              {assessment.flags.map((f) => (
                <FlagBadge key={f.ruleId} flag={f} />
              ))}
            </div>
            <div className="mt-1.5 text-[11px] text-slate-500">
              {formatAltitude(flight, units.alt)} · {formatDistance(flight.distanceNm, units.dist)}
            </div>
          </li>
        )
      })}
    </ul>
  )
}

export default function ReviewModal({
  records,
  title,
  onClose,
}: {
  records: ReviewRecord[]
  title: string
  onClose: () => void
}) {
  const items = useMemo(() => buildReviewItems(records), [records])
  const [view, setView] = useState<View>('list')
  const [selected, setSelected] = useState<ReviewItem | null>(null)

  return (
    <div className="fixed inset-0 z-[1200] flex items-end justify-center bg-black/60" onClick={onClose}>
      <div
        className="flex max-h-[94vh] w-full max-w-md flex-col overflow-hidden rounded-t-2xl border-t border-slate-700 bg-slate-900 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Review incident log"
      >
        <div className="shrink-0 border-b border-slate-800 p-4 pb-3">
          <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-slate-700" />
          <div className="flex items-center justify-between gap-3">
            <h2 className="min-w-0 truncate text-lg font-bold text-white">
              {title} <span className="text-sm font-normal text-slate-400">({items.length})</span>
            </h2>
            <button
              onClick={onClose}
              className="shrink-0 rounded-lg bg-slate-800 px-3 py-1.5 text-sm font-medium text-slate-300"
            >
              Close
            </button>
          </div>
          {items.length > 0 && (
            <div className="mt-3 flex rounded-lg border border-slate-700 bg-slate-800/50 p-1 text-sm font-medium">
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
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4">
          {items.length === 0 ? (
            <p className="rounded-lg border border-slate-700 bg-slate-800/40 p-4 text-center text-sm text-slate-400">
              No incidents found in this file. Expected a Fight or Flight incident-log CSV.
            </p>
          ) : view === 'list' ? (
            <Rows items={items} onSelect={setSelected} />
          ) : (
            <ReviewMap
              items={items}
              selectedId={selected?.record.id ?? null}
              onSelect={setSelected}
            />
          )}
        </div>
      </div>

      {selected && <ReviewDetail item={selected} onClose={() => setSelected(null)} />}
    </div>
  )
}
