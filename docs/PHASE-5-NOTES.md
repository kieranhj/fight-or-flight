# Phase 5 — Complaint generator + log

Status: **complete, pending your review.** Phase 6 (polish) won't start until you confirm.

## What shipped

**`complaint.ts`** — `buildComplaint(flight, assessment, userDetails, now)` fills an
editable template with everything the authorities ask for: complainant
name/address/postcode, UK date/time, aircraft id (callsign / registration / type /
Mode S hex), altitude, position + distance/bearing, heading/speed, the airport
classification, and the **triggered flags** as the "nature of issue". Rule flags are
phrased as indicative observations with a request to investigate — never as
accusations — and the message states the data is from public ADS-B and should be
verified.

**`ComplaintModal`** — two taps from a flight (open detail → "Generate complaint"):
- Editable "your details" (name/address/postcode), **persisted to localStorage**
  (`userDetails.ts`), seeded from the home location in config.
- Editable subject + message; regenerates from the template until you hand-edit it
  ("Reset to template" to revert).
- **Delivery is always hand-off, never auto-submit:** `mailto:` for email channels
  (Farnborough, Heathrow), **Copy text + Open form** deep link for web forms
  (Heathrow, Gatwick viewpoint), `tel:` for phone. A prominent banner says so.
- Transit/unknown flights (no owning airport) get a clear note pointing at the
  CAA/MP route, and you can still copy the text.

**`log.ts` + `IncidentLog`** — every delivery action saves a snapshot incident to
localStorage (flight + flags at that moment). The log view lists them, supports
per-item delete / clear-all, and **exports CSV** (your evidence base). A header
**Log (n)** button shows the count and opens it.

## Definition of Done

| DoD item | State |
|---|---|
| Two taps from a flagged flight → correct, editable, prefilled complaint to the right channel | ✅ detail → "Generate complaint" → prefilled modal; mailto/copy/deep-link per airport |
| Incident logged and exportable | ✅ saved on delivery; CSV export verified |
| Never auto-submits | ✅ mailto/copy/deep-link only, with explicit banner |

## Verified

- `npm run build` + typecheck clean (front-end + Worker).
- **Headless browser test** (fixed clock, stubbed flagged Farnborough flight, 13
  assertions): complaint prefills with name/address/postcode, date/time, aircraft id,
  altitude, position and the "Out of hours" flag; the Farnborough email channel
  appears; "Copy full text" writes the message to the clipboard and logs the incident;
  the log lists it; **CSV export downloads** with the right header + row. No runtime
  errors. Complaint + log screenshots captured.

## Notes / for later

- The complainant address/postcode is **seeded from the home location in config** and
  editable; it's stored only in your browser's localStorage and only ever travels in
  the message you send yourself.
- Heathrow/Gatwick web forms can't be auto-filled (cross-origin) — we copy the text
  and deep-link, as planned.
- Phase 6 can add a proper Settings screen (N / radius / units / home-location
  fallback), offline shell, and refined corridor geometry.
