// Shared between the fetch handler (index.ts) and the telemetry recorder
// (capture.ts): upstream feed access + raw-record helpers.

/** Sent on every upstream request so feed operators can identify / contact us. */
export const USER_AGENT = 'fight-or-flight (+github.com/kieranhj/fight-or-flight)'

/** Loose shape of an ADSBExchange-v2 aircraft record (airplanes.live / adsb.lol). */
export type RawAircraft = Record<string, unknown>

export function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

export function str(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const t = v.trim()
  return t.length > 0 ? t : null
}

/** Military bit (bit 0) of the ADSBExchange `dbFlags` bitfield. */
export function isMilitary(ac: RawAircraft): boolean {
  const flags = ac.dbFlags
  return typeof flags === 'number' && (flags & 1) === 1
}

const UPSTREAMS = [
  { source: 'airplanes.live', url: (la: number, lo: number, r: number) => `https://api.airplanes.live/v2/point/${la}/${lo}/${r}` },
  { source: 'adsb.lol', url: (la: number, lo: number, r: number) => `https://api.adsb.lol/v2/point/${la}/${lo}/${r}` },
] as const

/** Names of the feeds we poll, in priority order — used by the recorder to
 * tell "every feed is standing down" from "there is still one to try". */
export const UPSTREAM_NAMES: readonly string[] = UPSTREAMS.map((u) => u.source)

/** What one feed did when we asked. `status` is null for a network-level
 * failure (no HTTP response at all). */
export type UpstreamAttempt = { source: string; status: number | null; detail?: string }

/** Thrown when no feed produced data. Carries every attempt so the caller can
 * record WHY — without this the recorder cannot tell a block from an outage. */
export class UpstreamError extends Error {
  attempts: UpstreamAttempt[]
  constructor(attempts: UpstreamAttempt[]) {
    super(
      attempts.length
        ? attempts.map((a) => `${a.source} ${a.status ?? 'network-error'}`).join('; ')
        : 'no upstream available',
    )
    this.name = 'UpstreamError'
    this.attempts = attempts
  }
}

export type UpstreamOpts = {
  /** env.UPSTREAM_BASE — redirects to stub server(s) for offline testing. Accepts
   * a comma-separated list so the primary→fallback chain itself is testable,
   * which is the behaviour that matters when one feed starts refusing us. */
  baseOverride?: string
  /** Feeds to leave alone this call (backing off after they refused us). */
  skip?: ReadonlySet<string>
}

/**
 * One point query against the feeds: single attempt per feed, primary→fallback,
 * no immediate retry (responsible use — see worker/README.md). Returns every
 * attempt alongside the data, and throws UpstreamError carrying them when all
 * fail, so callers can act on the reason rather than just the absence.
 */
export async function fetchUpstream(
  lat: number,
  lon: number,
  radiusNm: number,
  opts: UpstreamOpts = {},
): Promise<{ source: string; aircraft: RawAircraft[]; attempts: UpstreamAttempt[] }> {
  const { baseOverride, skip } = opts
  const bases = baseOverride ? baseOverride.split(',').map((b) => b.trim()).filter(Boolean) : []
  const all = bases.length
    ? bases.map((base, i) => ({
        source: bases.length > 1 ? `override-${i + 1}` : 'override',
        url: (la: number, lo: number, r: number) => `${base}/v2/point/${la}/${lo}/${r}`,
      }))
    : UPSTREAMS
  const upstreams = skip ? all.filter((u) => !skip.has(u.source)) : all
  const attempts: UpstreamAttempt[] = []
  for (const up of upstreams) {
    try {
      const res = await fetch(up.url(lat, lon, radiusNm), {
        headers: { Accept: 'application/json', 'User-Agent': USER_AGENT },
        // Let Cloudflare cache the upstream briefly too, to dedupe load.
        cf: { cacheTtl: 8, cacheEverything: true },
      })
      if (!res.ok) {
        // Keep a short slice of the body: feeds explain refusals there, and that
        // explanation is the whole diagnosis when one starts saying no.
        const body = await res.text().catch(() => '')
        attempts.push({ source: up.source, status: res.status, detail: body.slice(0, 200) || undefined })
        continue
      }
      const data = (await res.json()) as { ac?: RawAircraft[] }
      attempts.push({ source: up.source, status: res.status })
      return { source: up.source, aircraft: Array.isArray(data.ac) ? data.ac : [], attempts }
    } catch (err) {
      attempts.push({ source: up.source, status: null, detail: String(err).slice(0, 200) })
    }
  }
  throw new UpstreamError(attempts)
}
