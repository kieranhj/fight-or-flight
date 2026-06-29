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
      // Condition 8 of planning permission 20/00871/REVPP, confirmed against
      // Rushmoor Borough Council's published operating-hours page (the planning
      // authority) and Farnborough Airport's own FAQ (June 2026): weekdays
      // 07:00–22:00; weekends and bank holidays 08:00–20:00; no flying on
      // Christmas Day or Boxing Day except in an emergency. (The permission also
      // caps movements at 50,000/yr with a non-weekday sub-cap — not modelled here.)
      weekday: { open: '07:00', close: '22:00' },
      weekend: { open: '08:00', close: '20:00' },
      bankHoliday: { open: '08:00', close: '20:00' },
      note: 'Weekdays 07:00–22:00; weekends and bank holidays 08:00–20:00. No flying Christmas Day or Boxing Day (bar emergencies). Source: Rushmoor BC operating-hours page; Condition 8 of planning permission 20/00871/REVPP.',
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
  EGLK: {
    icao: 'EGLK',
    name: 'Blackbushe',
    // 51°19′26″N 000°50′51″W, elevation 325 ft (Wikipedia / metar-taf).
    position: { lat: 51.32389, lon: -0.8475 },
    elevationFt: 325,
    hours: {
      // Standard hours are 07:00–18:00 every day (airport + ATSU; source:
      // blackbushe.com/hours, June 2026). The field can extend on request "up to
      // 22:00 local", and is closed 22:00–07:00. We use the OUTER envelope
      // 07:00–22:00 as the R1 permitted window so an approved evening extension is
      // not flagged as a definite breach; only movements outside 07:00–22:00 are.
      weekday: { open: '07:00', close: '22:00' },
      weekend: { open: '07:00', close: '22:00' },
      bankHoliday: { open: '07:00', close: '22:00' },
      note: 'Standard hours 07:00–18:00 daily; extensions on request up to 22:00 (closed 22:00–07:00). No flying Christmas Day. Source: blackbushe.com/hours. Indicative — light-GA airfield ~2.5 nm west of Farnborough.',
    },
    channels: [
      {
        kind: 'web-form',
        label: 'Noise complaint / contact form',
        url: 'https://blackbushe.com/contact-us',
        notes: 'Blackbushe is a small general-aviation airfield (light aircraft, flying schools, gliders, some light business jets). See blackbushe.com/noise for noise-abatement info.',
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
