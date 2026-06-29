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
      'Below the published expected altitude band for where it is. Indicative — approach traffic is legitimately low.',
  },
  {
    id: 'R3-corridor',
    label: 'Corridor proximity',
    severity: 'indicative',
    summary:
      'Outside every published Farnborough departure/arrival corridor swath. Indicative — review before acting.',
  },
]

/** Tunable thresholds consumed by the Phase 4 engine. */
export const RULE_THRESHOLDS = {
  /** R1: minutes of grace either side of a window edge before flagging out-of-hours. */
  hoursGraceMinutes: 5,
  /**
   * R2: feet below a zone's expected altitude band (minAltFt) before flagging.
   * The location now comes from point-in-polygon, so no distance gate is needed —
   * the WebTrak altitude zones are themselves bounded to the terminal area.
   */
  altitudeFloorMarginFt: 500,
  /**
   * R3: only test "off corridor" within this distance (nm) of Farnborough. The
   * published swaths extend ~15 nm out; beyond this gate a flight is legitimately
   * not yet on / already clear of a SID/STAR and flagging it would be noise.
   */
  corridorCheckMaxDistanceNm: 12,
}

/** Global UI disclaimer — flags are indicative, not proof (Build Plan §9). */
export const INDICATIVE_DISCLAIMER =
  'Flags are indicative, not proof. Operating-hours checks are clear-cut, but altitude and track use approximations and aircraft on approach are legitimately low. Always review before sending a complaint.'
