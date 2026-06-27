import type { Airport, LatLon } from './types'

// Seed reference data from Build Plan §7. Coordinates, hours and contacts are
// the researched starting point; several values (esp. Farnborough's exact
// weekday window) are flagged for verification in Phase 6. Treat as indicative.

export const AIRPORTS: Record<Airport['icao'], Airport> = {
  EGLF: {
    icao: 'EGLF',
    name: 'Farnborough',
    position: { lat: 51.2758, lon: -0.7763 },
    hours: {
      // Condition 8 of the planning permission. Weekday window is approximate
      // and must be verified against the 20/00871/REVPP decision notice.
      weekday: { open: '07:00', close: '22:00' },
      weekend: { open: '08:00', close: '20:00' },
      bankHoliday: { open: '08:00', close: '20:00' },
      note: 'No flying Christmas/Boxing Day (bar emergencies). Weekday window approximate — verify against the 20/00871/REVPP decision notice (Condition 8).',
    },
    channels: [
      {
        kind: 'email',
        label: 'Email complaints',
        email: 'complaints@farnboroughairport.com',
        notes: 'Identify the movement via WebTrak (webtrak.emsbk.com/fab) before sending.',
      },
      {
        kind: 'phone',
        label: 'Phone',
        phone: '01252 526001',
      },
    ],
    postalContact: 'Sustainability Manager, Farnborough Airport Ltd, GU14 6XA',
  },
  EGLL: {
    icao: 'EGLL',
    name: 'Heathrow',
    position: { lat: 51.47, lon: -0.4543 },
    hours: {
      // Heathrow has no general curfew; the night quota period is restricted,
      // not banned. Treated as informational by R1.
      weekday: { open: '00:00', close: '24:00' },
      weekend: { open: '00:00', close: '24:00' },
      bankHoliday: { open: '00:00', close: '24:00' },
      nightRestricted: { open: '23:30', close: '06:00' },
      note: 'Night quota period 23:30–06:00 is restricted, not banned — informational only.',
    },
    channels: [
      {
        kind: 'email',
        label: 'Email noise team',
        email: 'noise@heathrow.com',
      },
      {
        kind: 'phone',
        label: 'Freephone',
        phone: '0800 344 844',
      },
      {
        kind: 'web-form',
        label: 'WebTrak "Investigate" / online form',
        url: 'https://www.heathrow.com/company/local-community/noise/contact',
      },
    ],
  },
  EGKK: {
    icao: 'EGKK',
    name: 'Gatwick',
    position: { lat: 51.1481, lon: -0.1903 },
    hours: {
      weekday: { open: '00:00', close: '24:00' },
      weekend: { open: '00:00', close: '24:00' },
      bankHoliday: { open: '00:00', close: '24:00' },
      nightRestricted: { open: '23:30', close: '06:00' },
      note: 'Night quota period 23:30–06:00 is restricted, not banned — informational only.',
    },
    channels: [
      {
        kind: 'phone',
        label: 'Automated complaints line',
        phone: '07700 144 827',
      },
      {
        kind: 'web-form',
        label: 'Gatwick viewpoint form',
        url: 'https://viewpoint-eu.emsbk.com/lgw3',
      },
    ],
  },
}

export const AIRPORT_LIST: Airport[] = Object.values(AIRPORTS)

/** User's home / GPS fallback coordinate (Build Plan §7). */
export const HOME_LOCATION: LatLon & { elevationFt: number; label: string } = {
  lat: 51.188,
  lon: -0.802,
  elevationFt: 236, // ~72 m AMSL
  label: 'GU10 3RH, Dene Lane, Lower Bourne',
}
