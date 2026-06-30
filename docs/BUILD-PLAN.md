# Aircraft Complaint Assistant — Build Plan (Claude Code kickoff)
*A static web app, hosted on GitHub Pages, that on one tap lists the nearest aircraft to your location, shows their telemetry, flags any that look outside the local rules (Farnborough / Heathrow / Gatwick), and one-click-generates a prefilled, editable complaint to the right authority.*

> **Status (June 2026): ✅ all phases 0–6 complete and shipped.** This is the original
> kickoff plan, kept as a record; completed items are crossed off below. Work has since
> continued past the plan — notably **Blackbushe (EGLK)** added as a fourth airport, a
> **Farnborough ascent/descent trajectory heuristic**, and the corridor geometry replaced
> with **real Farnborough WebTrak swaths**. See [`../README.md`](../README.md) for the
> current state and the `PHASE-*-NOTES.md` / topic docs in this folder for detail.

---

## 1. Decisions locked in
- **Hosting:** Static front-end on **GitHub Pages** + a free **Cloudflare Worker** as a thin data proxy (solves CORS, smooths upstream rate limits via short caching, hides any future API key, and lets us enrich data server-side). Front-end talks only to the Worker.
- **Location:** **Device GPS** via the browser Geolocation API (mobile-first PWA — pull phone out, tap, done). A manual/home-coordinate fallback is a settings option, not the default.
- **Rule checking:** **Start simple, refine later.** v1 ships a deterministic *operating-hours* check plus *indicative* altitude-floor and corridor-proximity checks, all structured behind a clean rules engine so accuracy can be improved without rewrites.
- **Scope:** Farnborough (EGLF), Heathrow (EGLL), Gatwick (EGKK). Filter out military, helicopters and very light/hobbyist GA. *(Since extended: **Blackbushe (EGLK)** added as a fourth airport so light GA near Farnborough is attributed to it rather than false-positiving Farnborough; the normally-filtered categories can be toggled back on in Settings.)*
- **Submission:** Prefilled `mailto:` for email channels; prefilled copy-paste text + deep link for web-form channels (true auto-submit isn't possible from a browser).

---

## 2. Architecture

```
[ Phone browser (PWA, GitHub Pages) ]
        │  GPS: getCurrentPosition()
        │  GET https://<worker>.workers.dev/api/nearby?lat=&lon=&radius=&n=
        ▼
[ Cloudflare Worker proxy ]
        │  → GET api.airplanes.live/v2/point/{lat}/{lon}/{radius}   (primary)
        │  → fallback: api.adsb.lol  (ADSBExchange-v2 compatible)
        │  → optional: adsb.lol routeset (origin/destination airports)
        │  normalize · sort by distance · trim to N · classify airport
        │  add CORS headers · cache ~8s
        ▼
[ Front-end ]  rules engine (client) → list + map → complaint generator → local log
```

**Why the Worker even though GitHub Pages could *maybe* call the APIs directly:** the community feeds may not send CORS headers, are rate-limited to ~1 req/s, and route enrichment is cleaner batched server-side. The Worker removes all three problems and costs nothing on the free tier. **Phase 0 still tests direct browser calls first** — if a feed turns out to be CORS-friendly, the Worker simply becomes an optional cache/enrichment layer.

---

## 3. Tech stack
- **Front-end:** Vite + React + TypeScript; Tailwind for styling; Leaflet + OpenStreetMap tiles for the map; vite-plugin-pwa for installable/offline shell.
- **Proxy:** Cloudflare Worker (TypeScript), deployed with Wrangler.
- **CI/CD:** GitHub Actions → build → deploy to GitHub Pages. Worker deploys separately via `wrangler deploy`.
- **State/storage:** React state + `localStorage` (incident log; settings). No backend DB.

---

## 4. Data sources (verified June 2026)
| Source | Endpoint | Notes |
|---|---|---|
| **airplanes.live** (primary) | `GET https://api.airplanes.live/v2/point/{lat}/{lon}/{radius}` | Free, no key, radius up to 250 nm, **1 req/s**, non-commercial. ADSBExchange-v2 field format. |
| **adsb.lol** (fallback + routes) | `GET https://api.adsb.lol/v2/point/{lat}/{lon}/{radius}` ; `POST https://api.adsb.lol/api/0/routeset` | Free, no key (key "by feeding" planned later). Route lookup returns plausible origin/destination airports — used to tell which airport a flight belongs to. |
| OpenSky | (rejected for v1) | Now OAuth2 client-credentials only; secret can't live in a browser; anonymous is heavily rate-limited. Keep as a possible Worker-side source later. |
| FR24 / FlightAware | (optional, paid) | Richest data incl. origin/destination, but paid and usage-restricted. Only if you later want a paid tier. |

**Per-aircraft fields available** (ADSBExchange-v2): `hex`, `flight`/callsign, `r` (registration), `t` (ICAO type), `category` (A1–A7), `alt_baro`, `alt_geom`, `gs` (ground speed), `track`, `baro_rate` (vertical rate), `nav_altitude` (selected altitude), `lat`, `lon`, `squawk`, plus `dst`/`dir` (distance + bearing from the query point) on point queries. That is exactly the telemetry to display.

---

## 5. Repo structure
```
/                         GitHub Pages site root (built output)
  /src
    /config
      airports.ts         coords, ICAO, hours, complaint contacts/templates
      corridors.ts        RNAV centreline polylines + altitude bands (seed, refine later)
      rules.ts            rule definitions (hours, altitude, corridor)
      filters.ts          category/type exclusions (mil, rotorcraft, light GA)
    /lib
      geo.ts              haversine, point-to-polyline distance, bearing
      adsb.ts             call Worker /api/nearby, normalize
      classify.ts         map a flight → owning airport (route + position + alt + callsign)
      rulesEngine.ts      run rules over a flight, return flags
      complaint.ts        build prefilled message + delivery (mailto / copy / deep link)
      log.ts              localStorage incident log + CSV export
    /components
      NearbyButton, FlightList, FlightCard, FlightDetail, MapView,
      FlagBadge, ComplaintModal, IncidentLog, Settings
    App.tsx, main.tsx
  /worker
    src/index.ts          Cloudflare Worker: /api/nearby (+ /api/route)
    wrangler.toml
  /.github/workflows/deploy.yml
  vite.config.ts (base: '/<repo-name>/'), tailwind.config.js, manifest, icons
```

---

## 6. Build phases (give the agent one phase at a time)

> ✅ **All phases below are complete.** Each shipped one-PR-per-phase with notes in
> `docs/PHASE-N-NOTES.md`.

**✅ Phase 0 — Scaffold & prove the data path** — *done*
- Vite + React + TS + Tailwind; PWA plugin; GitHub Actions deploy to Pages (set `base`).
- Cloudflare Worker scaffold (Wrangler); `GET /api/nearby` returns a hard-coded sample, with CORS.
- Spike: from a throwaway page, try a **direct** browser call to airplanes.live; record whether CORS blocks it. Decide direct-vs-proxy (proxy is the default).
- **DoD:** blank app deploys to `https://<user>.github.io/<repo>/`; Worker reachable; CORS decision documented.

**✅ Phase 1 — Nearest-N telemetry (MVP)** — *done*
- Worker `/api/nearby?lat&lon&radius&n`: call airplanes.live point endpoint, normalize fields, sort by `dst`, trim to N, apply exclusion filters, cache ~8s, fallback to adsb.lol on error.
- Front-end: "Identify aircraft now" button → `getCurrentPosition()` → fetch → render a list of FlightCards (type, registration, callsign, altitude, speed, vertical rate, distance, bearing).
- **DoD:** on your phone, one tap shows a sorted, filtered list of real nearby aircraft with telemetry.

**✅ Phase 2 — Map** — *done*
- Leaflet map: your position (with accuracy ring) + aircraft markers rotated to `track`, tap a marker → FlightDetail.
- **DoD:** map shows you and the nearby aircraft; selection works.

**✅ Phase 3 — Classification (which airport)** — *done; since extended with the
Blackbushe airport, a per-airport size band + terminal radius, and a Farnborough
trajectory heuristic — see [`ASCENT-DESCENT-HEURISTIC.md`](./ASCENT-DESCENT-HEURISTIC.md).*
- Worker enriches each flight via adsb.lol routeset; `classify.ts` resolves the owning airport from route + proximity/heading to EGLF/EGLL/EGKK + altitude band + callsign prefix. Tag each flight (or "transit/unknown").
- **DoD:** flights show a sensible airport tag; unknowns are labelled, not guessed.

**✅ Phase 4 — Rules engine v1** — *done; R2/R3 now use point-in-polygon against the real
WebTrak corridor swaths — see [`CORRIDOR-DATA-EXTRACTION.md`](./CORRIDOR-DATA-EXTRACTION.md).*
- `rulesEngine.ts` runs `rules.ts` over each classified flight:
  - **R1 Hours (deterministic, strong):** compare current UK local time to the owning airport's permitted hours. Farnborough movement outside 08:00–20:00 at weekends/bank-holidays (or its weekday window) → **likely breach**. Heathrow/Gatwick in 23:30–06:00 → **night/restricted (informational)**, not a breach.
  - **R2 Altitude-floor (indicative):** Farnborough flight below a configured height for its distance band (design says climbing through ~4,000 ft over the Hog's Back) → flag "below design profile (indicative)."
  - **R3 Corridor proximity (indicative):** lateral offset from the nearest configured RNAV centreline beyond tolerance → flag "off designated track (indicative)."
- FlagBadge shows severity (breach / informational / indicative) with a one-line "why."
- **DoD:** an out-of-hours Farnborough movement is flagged reliably; altitude/corridor flags appear and are clearly marked indicative.

**✅ Phase 5 — Complaint generator + log** — *done*
- `complaint.ts` fills the owning authority's template with captured data + the triggered flag(s); ComplaintModal lets you edit; deliver via `mailto:` (Farnborough, Heathrow) or copy-paste + deep link (Heathrow form, Gatwick viewpoint). Always include name/address/postcode, date/time, aircraft id, altitude, position, nature of issue.
- `log.ts` saves each incident to localStorage; IncidentLog view; CSV export (your evidence base).
- **DoD:** from a flagged flight, two taps produce a correct, editable, prefilled complaint to the right channel; incident is logged and exportable.

**✅ Phase 6 — Polish** — *done*
- PWA install + offline shell; Settings (N, radius, home-location fallback, units); refine corridor geometry from the AIP and tune rule thresholds; empty/error/no-GPS states; attribution to the data source per its terms.
- Corridor geometry was sourced from **Farnborough WebTrak** (real swaths), not the AIP — see [`CORRIDOR-DATA-EXTRACTION.md`](./CORRIDOR-DATA-EXTRACTION.md). Farnborough operating hours confirmed — see [`DATA-RESEARCH.md`](./DATA-RESEARCH.md).

---

## 7. Seed reference data (already researched — hand to the agent)

**Airports**
- Farnborough **EGLF** ≈ 51.2758, −0.7763 · runway 06/24 · biz-jet hub.
- Heathrow **EGLL** ≈ 51.4700, −0.4543.
- Gatwick **EGKK** ≈ 51.1481, −0.1903.
- *(Added later)* Blackbushe **EGLK** ≈ 51.32389, −0.8475 · 325 ft · light-GA field ~2.5 nm west of Farnborough.

**Operating hours (for R1)**
- Farnborough: weekends/bank holidays **08:00–20:00**; weekdays ~**07:00–22:00**; no flying Christmas/Boxing Day (bar emergencies). (Hours sit in Condition 8 of the planning permission — verify exact weekday window against the decision notice.)
- Heathrow & Gatwick: night quota period **23:30–06:00** (restricted, not banned); treat as informational.

**Complaint channels (for templates)**
- Farnborough: `complaints@farnboroughairport.com` · 01252 526001 · Sustainability Manager, Farnborough Airport Ltd, GU14 6XA. Identify via WebTrak (webtrak.emsbk.com/fab). Oversight: Rushmoor airport-monitoring + your FACC rep.
- Heathrow: `noise@heathrow.com` · 0800 344 844 · WebTrak "Investigate" / online form.
- Gatwick: automated line 07700 144 827 · form viewpoint-eu.emsbk.com/lgw3.
- Airspace/route design: CAA airspace-change consultations + your MP. Military low-flying (out of scope): MOD.

**User home (GPS fallback)**
- GU10 3RH, Dene Lane, Lower Bourne — ≈ 51.188, −0.802 · ground ~72 m (236 ft) AMSL.

**Corridor / airspace seed (refine later)**
- Runway 24 southerly departures (GWC/HAZEL SIDs): climb ahead, after ~1,150 ft turn left onto ~220°. Design target ≥ 4,000 ft over the A31 Hog's Back. Encode a rough centreline polyline now; replace with real AIP waypoints in Phase 6.
- Controlled-airspace floor over Lower Bourne ≈ 2,000–2,500 ft AMSL (CTA-1 2,000–2,500; CTA-4 2,500–3,500) — useful context for altitude rules near home.

**Exclusion filters (for v1)**
- Drop `mil` flag; drop category **A7** (rotorcraft) and **A1** (light); optionally drop type codes for known light GA. Keep A2–A5 (small jet → heavy). This removes Chinooks and hobbyist traffic.
- *(Since extended)* the excluded categories can be toggled back on per-request in Settings, and A1 light traffic that does show is attributed to **Blackbushe** (or left unattributed when far from any field) rather than Farnborough.

---

## 8. Rules engine design (so v1 can grow)
Each rule is a small typed object: `{ id, label, severity: 'breach'|'info'|'indicative', appliesTo(flight): boolean, evaluate(flight, ctx): {triggered, reason} }`. `ctx` carries current local time, the owning-airport config, and the user's position. The engine returns an array of triggered flags per flight. Adding accuracy later = adding/replacing rule objects, never touching the UI. Keep all thresholds in `config/`, not in code.

---

## 9. Honest constraints (put these in the UI copy)
- Flags are **indicative, not proof**: hours are clear-cut, but altitude/track use approximations and aircraft legitimately on approach are low — always review before sending.
- The app **cannot auto-submit** to airport web forms; it prefills and hands off.
- Free ADS-B feeds have **no uptime guarantee**, depend on volunteer coverage, and can miss very low or masked aircraft.
- Respect each feed's **non-commercial terms** and add attribution.

---

## 10. Ready-to-paste kickoff prompt for Claude Code

> Build a mobile-first PWA called "Aircraft Complaint Assistant", deployed to GitHub Pages, with a Cloudflare Worker data proxy. Stack: Vite + React + TypeScript + Tailwind + Leaflet + vite-plugin-pwa; Worker in TypeScript via Wrangler. Work in the phases defined in `docs/BUILD-PLAN.md` (sections 5–8), one phase per PR, stopping at each phase's Definition of Done for my review.
>
> Start with **Phase 0**: scaffold the app and the Worker, wire up GitHub Actions deployment to Pages (set Vite `base` to the repo name), stub `GET /api/nearby` in the Worker with CORS, and run a spike to check whether `https://api.airplanes.live/v2/point/...` is callable directly from the browser (report the CORS result). Don't start Phase 1 until I confirm.
>
> Use the seed reference data in section 7 for airports, hours, complaint contacts and filters. Keep all thresholds and corridor geometry in `/src/config`. Treat rule flags as indicative and make that explicit in the UI. Never auto-submit complaints — prefill `mailto:`/copy-paste only.

---

## 11. Open items to confirm as you go
- ~~Exact Farnborough **weekday** hours and the precise Condition number.~~ ✅ **Confirmed** — weekdays 07:00–22:00; weekends/bank holidays 08:00–20:00 (Condition 8 of permission 20/00871/REVPP, Rushmoor BC). See [`DATA-RESEARCH.md`](./DATA-RESEARCH.md).
- ~~Real **RNAV waypoint coordinates** for the Rwy 24 SIDs / arrival STARs to replace the seed corridor polylines.~~ ✅ **Sourced** — replaced with the real Farnborough **WebTrak** swaths (arrival + departure), used via point-in-polygon. See [`CORRIDOR-DATA-EXTRACTION.md`](./CORRIDOR-DATA-EXTRACTION.md).
- Whether to add a **paid** data tier later for reliable origin/destination (FR24/FlightAware) — not needed for v1. *(Still open; the trajectory heuristic mitigates route-less biz jets.)*
- adsb.lol's future **API-key-by-feeding** change — the Worker isolates you from it. *(Still open.)*
