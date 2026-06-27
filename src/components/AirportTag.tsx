import type { Classification } from '../lib/classify'

// Full literal class strings (Tailwind can't see dynamically-built names).
const STYLES: Record<string, { solid: string; outline: string }> = {
  EGLF: {
    solid: 'bg-amber-500/20 text-amber-300 border-amber-500/40',
    outline: 'text-amber-300/90 border-amber-500/50 border-dashed',
  },
  EGLL: {
    solid: 'bg-sky-500/20 text-sky-300 border-sky-500/40',
    outline: 'text-sky-300/90 border-sky-500/50 border-dashed',
  },
  EGKK: {
    solid: 'bg-violet-500/20 text-violet-300 border-violet-500/40',
    outline: 'text-violet-300/90 border-violet-500/50 border-dashed',
  },
}
const TRANSIT = 'bg-slate-700/40 text-slate-300 border-slate-600'

const BASE =
  'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold'

export default function AirportTag({ classification: c }: { classification: Classification }) {
  if (c.airport == null) {
    return (
      <span className={`${BASE} ${TRANSIT}`} title={c.reason}>
        {c.label}
      </span>
    )
  }
  const s = STYLES[c.airport]
  return (
    <span className={`${BASE} ${c.indicative ? s.outline : s.solid}`} title={c.reason}>
      {c.indicative ? `~${c.label}` : c.label}
      {c.indicative && <span className="font-normal opacity-70">indicative</span>}
    </span>
  )
}
