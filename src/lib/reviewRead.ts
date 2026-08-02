// "Reviewed up to" watermark for the For Review list.
//
// One epoch-second value: every flagged flight whose evidence moment is at or
// before it counts as read. A watermark rather than per-flight state because
// that is what "mark everything up to now as read" actually means — and it
// stays correct as new flights arrive, with nothing to migrate as history grows.
//
// Device-local, like settings and the incident log; it never leaves the device
// and is not part of the evidence.

const KEY = 'foaf.reviewReadAt'

/** Epoch seconds; 0 when nothing has been marked read (so everything is unread). */
export function loadReadAt(): number {
  try {
    const raw = localStorage.getItem(KEY)
    const n = raw == null ? 0 : Number(raw)
    return Number.isFinite(n) && n > 0 ? n : 0
  } catch {
    return 0
  }
}

/** Pass 0 to clear the watermark (everything unread again). */
export function saveReadAt(tsSec: number): void {
  try {
    if (tsSec > 0) localStorage.setItem(KEY, String(Math.floor(tsSec)))
    else localStorage.removeItem(KEY)
  } catch {
    /* ignore quota / disabled storage */
  }
}
