// Rule thresholds and descriptors (Build Plan §8). The actual rules engine lands
// in Phase 4; this file holds the tunable config and the catalogue of rules so
// the engine and UI can be built over a stable shape. Keep ALL thresholds here,
// never inline in engine code.

export type RuleSeverity = 'breach' | 'info' | 'indicative'

export type RuleDescriptor = {
  id: 'R1-hours' | 'R2-altitude' | 'R3-corridor'
  label: string
  severity: RuleSeverity
  /** One-line plain-English summary shown in the UI. */
  summary: string
}

/**
 * Severity semantics:
 *  - 'breach'      deterministic and strong (e.g. clear out-of-hours movement)
 *  - 'info'        restricted-but-permitted context (e.g. night quota period)
 *  - 'indicative'  approximation; must be reviewed before acting
 */
export const RULES: RuleDescriptor[] = [
  {
    id: 'R1-hours',
    label: 'Operating hours',
    severity: 'breach',
    summary:
      'Movement outside the owning airport’s permitted hours. Deterministic — the strongest flag.',
  },
  {
    id: 'R2-altitude',
    label: 'Altitude floor',
    severity: 'indicative',
    summary:
      'Below the design altitude profile for its distance band. Indicative — approach traffic is legitimately low.',
  },
  {
    id: 'R3-corridor',
    label: 'Corridor proximity',
    severity: 'indicative',
    summary:
      'Lateral offset beyond tolerance from the nearest configured RNAV centreline. Indicative — seed geometry only.',
  },
]

/** Tunable thresholds consumed by the Phase 4 engine. */
export const RULE_THRESHOLDS = {
  /** R1: minutes of grace either side of a window edge before flagging out-of-hours. */
  hoursGraceMinutes: 5,
  /**
   * R2: only apply the indicative altitude-floor check to flights within this
   * distance (nm) of the owning airport, to avoid flagging legitimate approaches.
   */
  altitudeCheckMaxDistanceNm: 8,
  /** R2: feet below the corridor's designAltitudeFt before flagging. */
  altitudeFloorMarginFt: 500,
  /** R3: handled per-corridor via Corridor.toleranceNm; this is the default fallback. */
  corridorDefaultToleranceNm: 1.5,
  /**
   * R3: upper bound (nm) on lateral offset before we STOP flagging. Beyond this a
   * flight is clearly not on the (single, seed) encoded SID at all, so flagging it
   * "off track" would be noise rather than signal.
   */
  corridorMaxOffsetNm: 5,
}

/** Global UI disclaimer — flags are indicative, not proof (Build Plan §9). */
export const INDICATIVE_DISCLAIMER =
  'Flags are indicative, not proof. Operating-hours checks are clear-cut, but altitude and track use approximations and aircraft on approach are legitimately low. Always review before sending a complaint.'
