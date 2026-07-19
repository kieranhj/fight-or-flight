import type { ReviewRecord } from './incidentCsv'
import { recordToFlight } from './incidentCsv'
import type { NormalizedFlight } from './adsb'
import { assessFlight, type Assessment } from './assess'
import { CORRIDORS } from '../config/corridors'
import { pointInPolygon } from './geo'

// Re-run the heuristics over a logged incident: classification + rules evaluated
// AT THE LOGGED TIME (so the hours check reflects when it actually happened), plus
// an explicit corridor inside/outside readout for the detail view.

export type CorridorReadout = {
  /** True if the logged position sits inside any published corridor swath. */
  inside: boolean
  /** The swath the flight is inside (first match), or null when outside all. */
  label: string | null
  /** How many corridor swaths were tested for this airport. */
  checked: number
}

export type ReviewItem = {
  record: ReviewRecord
  flight: NormalizedFlight
  /** The moment the incident was observed (used for the hours re-check). */
  when: Date
  assessment: Assessment
  corridor: CorridorReadout | null
}

function corridorReadout(flight: NormalizedFlight, assessment: Assessment): CorridorReadout | null {
  if (flight.lat == null || flight.lon == null) return null
  const icao = assessment.classification.airport
  const relevant = icao ? CORRIDORS.filter((c) => c.airport === icao) : CORRIDORS
  if (relevant.length === 0) return null
  const pos = { lat: flight.lat, lon: flight.lon }
  const hit = relevant.find((c) => pointInPolygon(pos, c.polygon))
  return { inside: hit != null, label: hit?.label ?? null, checked: relevant.length }
}

export function buildReviewItem(r: ReviewRecord): ReviewItem {
  const flight = recordToFlight(r)
  const when = new Date(r.observedAt ?? r.loggedAt ?? Date.now())
  const assessment = assessFlight(flight, when)
  return { record: r, flight, when, assessment, corridor: corridorReadout(flight, assessment) }
}

export function buildReviewItems(records: ReviewRecord[]): ReviewItem[] {
  return records.map(buildReviewItem)
}
