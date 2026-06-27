export type NearbyStatus = 'idle' | 'locating' | 'loading' | 'ready' | 'error'

const LABELS: Record<NearbyStatus, string> = {
  idle: 'Identify aircraft now',
  locating: 'Getting your location…',
  loading: 'Finding nearby aircraft…',
  ready: 'Refresh',
  error: 'Try again',
}

export default function NearbyButton({
  status,
  onClick,
}: {
  status: NearbyStatus
  onClick: () => void
}) {
  const busy = status === 'locating' || status === 'loading'
  return (
    <button
      onClick={onClick}
      disabled={busy}
      className="flex w-full items-center justify-center gap-2 rounded-xl bg-sky-500 px-4 py-4 text-base font-semibold text-white shadow-lg shadow-sky-500/20 transition active:scale-[0.99] disabled:opacity-70"
    >
      {busy && (
        <span
          className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white"
          aria-hidden
        />
      )}
      {LABELS[status]}
    </button>
  )
}
