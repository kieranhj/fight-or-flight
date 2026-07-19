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

/**
 * One point query against the feeds: single attempt per feed, primary→fallback,
 * no immediate retry (responsible use — see worker/README.md). `baseOverride`
 * (env.UPSTREAM_BASE) redirects to a local stub server for offline testing.
 */
export async function fetchUpstream(
  lat: number,
  lon: number,
  radiusNm: number,
  baseOverride?: string,
): Promise<{ source: string; aircraft: RawAircraft[] }> {
  const upstreams = baseOverride
    ? [{ source: 'override', url: (la: number, lo: number, r: number) => `${baseOverride}/v2/point/${la}/${lo}/${r}` }]
    : UPSTREAMS
  let lastError: unknown
  for (const up of upstreams) {
    try {
      const res = await fetch(up.url(lat, lon, radiusNm), {
        headers: { Accept: 'application/json', 'User-Agent': USER_AGENT },
        // Let Cloudflare cache the upstream briefly too, to dedupe load.
        cf: { cacheTtl: 8, cacheEverything: true },
      })
      if (!res.ok) {
        lastError = new Error(`${up.source} HTTP ${res.status}`)
        continue
      }
      const data = (await res.json()) as { ac?: RawAircraft[] }
      return { source: up.source, aircraft: Array.isArray(data.ac) ? data.ac : [] }
    } catch (err) {
      lastError = err
    }
  }
  throw lastError ?? new Error('all upstreams failed')
}
