import type { NormalizedFlight } from '../lib/adsb'
import { aircraftKind, KIND_LABEL, type AircraftKind } from '../lib/aircraft'

// Full literal class strings so Tailwind keeps them.
const STYLE: Record<AircraftKind, string> = {
  military: 'bg-orange-500/20 text-orange-300 border-orange-500/40',
  helicopter: 'bg-violet-500/20 text-violet-300 border-violet-500/40',
  light: 'bg-teal-500/20 text-teal-300 border-teal-500/40',
  'small-jet': 'bg-sky-500/20 text-sky-300 border-sky-500/40',
  'medium-jet': 'bg-blue-500/20 text-blue-300 border-blue-500/40',
  'large-jet': 'bg-indigo-500/20 text-indigo-300 border-indigo-500/40',
  'heavy-jet': 'bg-fuchsia-500/20 text-fuchsia-300 border-fuchsia-500/40',
  'fast-jet': 'bg-cyan-500/20 text-cyan-300 border-cyan-500/40',
  other: 'bg-slate-700/50 text-slate-300 border-slate-600',
}

const BASE =
  'inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold'

export default function KindTag({ flight }: { flight: NormalizedFlight }) {
  const kind = aircraftKind(flight)
  return <span className={`${BASE} ${STYLE[kind]}`}>{KIND_LABEL[kind]}</span>
}
