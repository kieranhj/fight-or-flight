import type { NormalizedFlight } from './adsb'
import type { Classification } from './classify'
import type { Flag } from './rulesEngine'
import { classifyFlight } from './classify'
import { runRules, buildContext } from './rulesEngine'

export type Assessment = {
  classification: Classification
  flags: Flag[]
}

/** Classify a flight and run the rules engine over it in one call. */
export function assessFlight(flight: NormalizedFlight, now: Date = new Date()): Assessment {
  const classification = classifyFlight(flight)
  const flags = runRules(flight, buildContext(classification, now))
  return { classification, flags }
}

/** Highest-severity flag present, for at-a-glance UI (breach > info > indicative). */
export function topSeverity(flags: Flag[]): 'breach' | 'info' | 'indicative' | null {
  if (flags.some((f) => f.severity === 'breach')) return 'breach'
  if (flags.some((f) => f.severity === 'info')) return 'info'
  if (flags.some((f) => f.severity === 'indicative')) return 'indicative'
  return null
}
