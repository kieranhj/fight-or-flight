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

/**
 * Last day with recorded telemetry, or null while the recorder is running.
 *
 * Recording was paused on 2026-08-20 (see docs/RECORDING-PAUSE.md). The archive
 * is kept and stays browsable — this bounds it, so the History screens read as a
 * closed record rather than a live one that stopped updating: no trailing run of
 * empty days in the chart, no replay opening on a blank "today", and no incident
 * offering a jump to a replay that was never recorded.
 *
 * Set back to null when capture resumes (alongside the crons in
 * worker/wrangler.toml and the RECORDING_PAUSED var).
 */
export const RECORDING_END: string | null = '2026-08-20'

/** Date ranges (inclusive, UTC days) excluded from the Offenders list. The
 * Farnborough International Airshow operates under its own consents, so flights
 * in show week — including the arrivals weekend before and exodus after — are
 * not representative of normal operations and would poison the repeat-offender
 * stats. Raw telemetry and D1 rows are kept; the filter applies at query time. */
export const OFFENDER_EXCLUDED_PERIODS: { from: string; to: string; label: string }[] = [
  {
    from: '2026-07-19',
    to: '2026-07-27',
    label: 'Farnborough International Airshow 2026 (incl. arrivals & exodus)',
  },
]

/**
 * Days the recorder captured so little that the day's TOTAL is meaningless.
 *
 * Distinct from OFFENDER_EXCLUDED_PERIODS, and deliberately not merged with it.
 * An airshow day is real traffic under different rules, so it is dropped from
 * the review list as well as the stats. A partial-capture day is the opposite:
 * the traffic was normal and our instrument failed, so the flights we *did*
 * record are perfectly valid observations and stay in the review list — it is
 * only the per-day rate that must not be averaged, because dividing real
 * movements by a day we barely watched understates every figure derived from it.
 *
 * Applied to the averages and their weekly/monthly projections only. Cumulative
 * totals still include these days: 8 movements were genuinely observed on
 * 20 August, and the "Farnborough movements" tile is a count of what we saw.
 */
export const INCOMPLETE_CAPTURE_DAYS: { from: string; to: string; label: string }[] = [
  {
    from: '2026-08-20',
    to: '2026-08-20',
    // 8 movements / 2,035 records, against ~55 / ~10,000 on the days either
    // side. adsb.lol was rate-limiting us into 80-minute stand-downs for much
    // of the day, and recording was paused at 19:57 UTC.
    label: 'Partial capture — feed rate-limited, recording paused at 19:57 UTC',
  },
]
