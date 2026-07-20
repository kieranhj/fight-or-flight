// Farnborough movement caps, for the History stats screens. VERIFIED against
// Rushmoor Borough Council (the planning authority), July 2026:
//  - Total cap: 50,000 aircraft movements per year (planning permission
//    20/00871/REVPP, carried over from the 2011 appeal decision).
//  - Non-weekday (weekend + bank holiday) sub-cap: 8,900 movements per year,
//    set by the 2011 appeal.
//  - PENDING: application 25/00615/REV (Nov 2025) seeks to raise the
//    non-weekday cap to 13,500 (total unchanged) — undecided at last check.
// Sources: rushmoor.gov.uk Farnborough Airport planning pages.

export const FARNBOROUGH_PERMITS = {
  annualMovementCap: 50_000,
  /** Weekend + bank-holiday sub-cap (the caps the 2025 application would raise). */
  nonWeekdayMovementCap: 8_900,
  sourceNote:
    'Caps per planning permission 20/00871/REVPP (50,000/yr; 8,900 weekend/bank-holiday), verified against Rushmoor BC July 2026. Application 25/00615/REV (pending) seeks 13,500 non-weekday.',
}

/** First day with recorded telemetry (the recorder went live 21:05 UTC). */
export const RECORDING_START = '2026-07-19'
