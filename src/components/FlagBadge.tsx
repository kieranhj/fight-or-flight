import type { Flag } from '../lib/rulesEngine'

// Severity styling. 'breach' is the only assertive (solid red) state; 'info' is
// neutral; 'indicative' is dashed to signal "approximation, review before acting".
const SEVERITY: Record<Flag['severity'], { cls: string; prefix: string }> = {
  breach: { cls: 'bg-rose-500/20 text-rose-200 border-rose-500/60', prefix: '⚠ ' },
  info: { cls: 'bg-sky-500/15 text-sky-200 border-sky-500/40', prefix: '' },
  indicative: { cls: 'text-amber-300/90 border-amber-500/50 border-dashed', prefix: '~' },
}

const BASE =
  'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold'

export default function FlagBadge({ flag }: { flag: Flag }) {
  const s = SEVERITY[flag.severity]
  return (
    <span className={`${BASE} ${s.cls}`} title={flag.reason}>
      {s.prefix}
      {flag.short}
      {flag.severity === 'indicative' && (
        <span className="font-normal opacity-70">indicative</span>
      )}
    </span>
  )
}
