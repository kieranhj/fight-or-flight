import type { NormalizedFlight } from './adsb'
import type { Assessment } from './assess'
import type { Airport } from '../config/types'
import { AIRPORTS } from '../config/airports'
import { flightTitle } from './format'
import type { UserDetails } from './userDetails'

// Builds a prefilled, EDITABLE complaint. Delivery is always hand-off (mailto /
// copy-paste / deep link) — we never auto-submit (Build Plan §1, §9). Rule flags
// are presented as indicative observations with a request to investigate, never
// as accusations.

export type Complaint = {
  subject: string
  body: string
  airport: Airport | null
}

function ukDateTime(now: Date): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London',
    dateStyle: 'full',
    timeStyle: 'short',
  }).format(now)
}

export function buildComplaint(
  flight: NormalizedFlight,
  assessment: Assessment,
  user: UserDetails,
  now: Date = new Date(),
): Complaint {
  const { classification, flags } = assessment
  const airport = classification.airport ? AIRPORTS[classification.airport] : null
  const when = ukDateTime(now)
  const title = flightTitle(flight)

  const aircraftId =
    [
      flight.callsign && `callsign ${flight.callsign}`,
      flight.registration && `registration ${flight.registration}`,
      flight.type && `type ${flight.type}`,
      flight.hex && `Mode S hex ${flight.hex.toUpperCase()}`,
    ]
      .filter(Boolean)
      .join(', ') || 'unknown'

  const altitude =
    flight.altBaroFt != null ? `${flight.altBaroFt.toLocaleString()} ft (barometric)` : 'unknown'
  const position =
    flight.lat != null && flight.lon != null
      ? `${flight.lat.toFixed(4)}, ${flight.lon.toFixed(4)}`
      : 'unknown'
  const distance =
    flight.distanceNm != null
      ? `${flight.distanceNm.toFixed(1)} nm from my location${
          flight.bearingDeg != null ? `, bearing ${Math.round(flight.bearingDeg)}°` : ''
        }`
      : null

  const issue = flags.length
    ? flags
        .map(
          (f) =>
            `  - ${f.short} (${f.severity === 'breach' ? 'possible breach' : f.severity}): ${f.reason}`,
        )
        .join('\n')
    : '  - General noise/disturbance (no automated rule flag was triggered).'

  const subject = `Aircraft noise complaint — ${title}${airport ? ` (${airport.name})` : ''}, ${when}`

  const lines: (string | null)[] = [
    airport ? `To the ${airport.name} noise / complaints team,` : 'To whom it may concern,',
    '',
    'I wish to report aircraft noise and disturbance observed from my location, with the details below.',
    '',
    'Complainant:',
    `  ${user.name || '[your name]'}`,
    `  ${user.address || '[your address]'}`,
    `  ${user.postcode || '[your postcode]'}`,
    '',
    `Date / time (UK local): ${when}`,
    `Aircraft: ${aircraftId}`,
    `Altitude: ${altitude}`,
    `Position: ${position}${distance ? ` (${distance})` : ''}`,
    flight.track != null || flight.groundSpeedKt != null
      ? `Heading / speed: ${flight.track != null ? `${Math.round(flight.track)}°` : '?'}${
          flight.groundSpeedKt != null ? ` at ${Math.round(flight.groundSpeedKt)} kt` : ''
        }`
      : null,
    airport
      ? `Identified as: ${airport.name}${
          classification.indicative ? ' (indicative)' : ''
        } — ${classification.reason}`
      : null,
    '',
    'Nature of issue:',
    issue,
    '',
    'These details were captured from public ADS-B data (via airplanes.live / adsb.lol) by a personal monitoring app. Altitude, position and any rule observations are indicative and should be verified against your own radar / WebTrak records. Please could you investigate this movement, confirm whether it was operating within the permitted conditions, and acknowledge this complaint.',
    '',
    'Regards,',
    user.name || '[your name]',
  ]

  return { subject, body: lines.filter((l) => l !== null).join('\n'), airport }
}

export function mailtoUrl(email: string, subject: string, body: string): string {
  return `mailto:${email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`
}
