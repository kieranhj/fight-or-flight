// Shared config types. Kept separate from data so rule/UI code can import the
// shapes without pulling in the seed values.

export type LatLon = { lat: number; lon: number }

/** A complaint delivery channel for an airport. */
export type ComplaintChannel = {
  kind: 'email' | 'web-form' | 'phone'
  label: string
  /** Email address for `mailto:` channels. */
  email?: string
  /** Deep link for web-form / viewpoint channels (we prefill + copy, never auto-submit). */
  url?: string
  /** Phone number for phone channels. */
  phone?: string
  notes?: string
}

/**
 * Operating-hours window for the deterministic R1 rule.
 * Times are local UK time in "HH:MM" 24h form. A movement *outside* the
 * permitted window is the basis for an out-of-hours flag.
 */
export type HoursWindow = {
  /** Inclusive open time, e.g. "08:00". */
  open: string
  /** Exclusive close time, e.g. "20:00". */
  close: string
}

export type AirportHours = {
  /** Mon–Fri permitted window. */
  weekday: HoursWindow
  /** Sat/Sun permitted window. */
  weekend: HoursWindow
  /** Bank-holiday window (often same as weekend). */
  bankHoliday: HoursWindow
  /**
   * Optional "restricted / night quota" window treated as informational
   * (e.g. Heathrow/Gatwick 23:30–06:00) rather than a breach.
   */
  nightRestricted?: HoursWindow
  /** Human-readable caveat shown in the UI; hours are indicative until verified. */
  note?: string
}

export type Airport = {
  icao: 'EGLF' | 'EGLL' | 'EGKK' | 'EGLK'
  name: string
  position: LatLon
  /** Ground elevation AMSL in feet, where known (context for altitude rules). */
  elevationFt?: number
  hours: AirportHours
  channels: ComplaintChannel[]
  /** Postal contact for the complaint template, where applicable. */
  postalContact?: string
}
