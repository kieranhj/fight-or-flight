# Fight or Flight

A mobile-first PWA that, on one tap, lists the nearest aircraft to your location,
shows their telemetry, flags any that look outside the local rules (Farnborough /
Heathrow / Gatwick), and one-click-generates a prefilled, **editable** complaint
to the right authority. Hosted on GitHub Pages with a Cloudflare Worker data proxy.

> Flags are **indicative, not proof**. The app never auto-submits — it prefills a
> `mailto:` or copy-paste message and hands off to you.

## Stack

- **Front-end**: Vite + React + TypeScript + Tailwind + Leaflet + `vite-plugin-pwa`
- **Proxy**: Cloudflare Worker (TypeScript) via Wrangler — the front-end talks only to it
- **Hosting**: GitHub Pages (front-end) + `*.workers.dev` (Worker)

See [`docs/BUILD-PLAN.md`](./docs/BUILD-PLAN.md) for the original plan and phased
roadmap (all phases complete). Work proceeded one phase per PR, stopping at each
phase's Definition of Done for review.

## Status

- **Phase 0 — Scaffold & prove the data path: ✅ done.** See
  [`docs/PHASE-0-NOTES.md`](./docs/PHASE-0-NOTES.md) (incl. the CORS spike: direct
  calls work, but the Worker proxy stays the default).
- **Phase 1 — Nearest-N telemetry (MVP): ✅ done.** Worker calls the feed for real
  (normalize → filter → sort → trim → ~8s cache);
  one tap → GPS → distance-sorted FlightCards. See
  [`docs/PHASE-1-NOTES.md`](./docs/PHASE-1-NOTES.md).
- **Phase 2 — Map: ✅ done.** Leaflet map with your position + accuracy ring and
  heading-rotated aircraft markers; tap a marker or card for a full telemetry detail
  sheet. See [`docs/PHASE-2-NOTES.md`](./docs/PHASE-2-NOTES.md).
- **Phase 3 — Classification: ✅ done.** Worker enriches flights with adsb.lol route
  data; `classify.ts` tags each as Farnborough/Heathrow/Gatwick (route-confirmed or
  indicative-by-proximity) or transit/unknown — labelled, never guessed. See
  [`docs/PHASE-3-NOTES.md`](./docs/PHASE-3-NOTES.md).
- **Phase 4 — Rules engine v1: ✅ done.** `rulesEngine.ts` runs R1 hours
  (deterministic breach), R2 altitude-floor and R3 corridor (both indicative) over
  each classified flight; `FlagBadge` shows severity + a one-line why. See
  [`docs/PHASE-4-NOTES.md`](./docs/PHASE-4-NOTES.md).
- **Phase 5 — Complaint generator + log: ✅ done.** Two taps from a flight prefill an
  editable complaint to the right authority (`mailto:` / copy + deep link — never
  auto-submitted); each is saved to a localStorage incident log with CSV export. See
  [`docs/PHASE-5-NOTES.md`](./docs/PHASE-5-NOTES.md).
- **Phase 6 — Polish: ✅ done.** Settings (N, radius, units, home-location fallback,
  complainant details), offline handling, and edge-state polish. Both deferred
  accuracy items resolved: Farnborough operating hours confirmed, and the corridor
  geometry replaced with the real Farnborough WebTrak swaths (point-in-polygon R2/R3).
  See [`docs/PHASE-6-NOTES.md`](./docs/PHASE-6-NOTES.md) and
  [`docs/CORRIDOR-DATA-EXTRACTION.md`](./docs/CORRIDOR-DATA-EXTRACTION.md).

### Beyond the plan

- **Real Farnborough corridors.** Seed centrelines replaced with the published
  Farnborough **WebTrak** swaths (arrival + departure), captured to
  [`docs/data/`](./docs/data) and consumed by R2/R3 via point-in-polygon. See
  [`docs/CORRIDOR-DATA-EXTRACTION.md`](./docs/CORRIDOR-DATA-EXTRACTION.md).
- **Farnborough trajectory heuristic.** Route-less business jets are inferred as
  arriving/departing Farnborough from descent/climb + corridor alignment, catching
  inbound/outbound jets the route DB misses. See
  [`docs/ASCENT-DESCENT-HEURISTIC.md`](./docs/ASCENT-DESCENT-HEURISTIC.md).
- **Blackbushe (EGLK).** Added as a fourth airport. A per-airport ADS-B size band and
  terminal radius attribute light GA near Farnborough to Blackbushe, and leave
  low-and-far hobbyist traffic unattributed rather than false-positiving Farnborough.
- **Map & display.** Per-kind corridor overlay toggles (departure / arrival), an
  optional "re-centre on refresh" toggle, and very-low unknown-category aircraft drawn
  as light rather than full-size.
- **Continuous telemetry recorder (H1).** The Worker's cron triggers record every
  aircraft within 25 nm of Farnborough Airport to R2 (15 s cadence, gzipped NDJSON, minute→hour→day
  compaction) for later analysis: Farnborough movement stats vs permits, day replay,
  offender tagging. See [`docs/TELEMETRY-CAPTURE-PLAN.md`](./docs/TELEMETRY-CAPTURE-PLAN.md)
  and [`docs/PHASE-H1-NOTES.md`](./docs/PHASE-H1-NOTES.md).
- **Nightly flight summaries (H2).** The nightly cron sessionizes each day's capture
  into D1: one row per flight, EGLF/EGLK movements ground-truthed from on-ground
  samples (geometry fallback when coverage misses the ground segment), R1/R2/R3
  rule flags evaluated at the logged times, and daily stats — queryable via
  `/api/history/flights` + `/api/history/stats`. See
  [`docs/PHASE-H2-NOTES.md`](./docs/PHASE-H2-NOTES.md).
- **History tab (H3).** Stats vs the verified Farnborough permit caps (50,000/yr;
  8,900 weekend/BH — Rushmoor BC, with the pending 25/00615/REV increase noted), a
  tappable daily movements strip, and a per-day flight log with Farnborough/Flagged
  filters and full detail sheets. See [`docs/PHASE-H3-NOTES.md`](./docs/PHASE-H3-NOTES.md).
- **Day replay (H4).** Scrub any recorded day — including today, live-merged — on the
  map: interpolated positions at a draggable playhead, 5-minute trails, play/pause at
  1–15 replay-minutes per second, tap an aircraft for its state at that moment. See
  [`docs/PHASE-H4-NOTES.md`](./docs/PHASE-H4-NOTES.md).
- **"For Review" & post-hoc complaints (H5).** Every auto-flagged flight, aggregated
  by airframe so repeat appearances stand out, with a jump into replay at the flagged
  moment, post-hoc complaints prefilled with the logged time and the **stored** flag
  reasons (never auto-sent), and an evidence-grade CSV export. Routes for movements
  and flagged flights are persisted at rollup. Named *for review* rather than
  *offenders*: R2/R3 flags are indicative and want a human look, not a verdict. See
  [`docs/PHASE-H5-NOTES.md`](./docs/PHASE-H5-NOTES.md).
- **Unread / mark-read.** The flagged list outgrew scrolling, so it carries a
  device-local "reviewed up to" watermark: **Mark read** draws a line at the current
  moment and later flights arrive as unread. Nothing is deleted — *All* always shows
  the full window, and an accidental tap is one **Undo** away.
- **Farnborough averages.** Stats shows mean movements per weekday and per
  weekend/bank-holiday day, plus projected weekly and monthly figures. Averages
  exclude airshow week (which runs under separate consents) while the cumulative
  totals still include it, because the annual caps count every movement; the
  projections are labelled as such and each tile shows its sample size.
- **Complain from anywhere.** The replay card and the recorded-flights sheet both
  generate complaints, not just the live map and the review list. A replay complaint
  is about the aircraft *at the playhead* (with its real position); a flights-list
  complaint cites the stored D1 flags verbatim.
- **Route-provider fallback chain.** Origin/destination lookups walk
  `adsbdb → hexdb` rather than pinning one source, with per-provider backoff on a
  429 or 403 and per-callsign edge caching. Pinning was the actual bug: adsbdb
  once rate-limited our shared egress, then hexdb began serving a Cloudflare bot
  challenge to Workers, which silently killed every lookup. Airport display names
  come from the route response itself, so a blocked name service can no longer
  downgrade "Shannon (SNN)" to "EINN".
- **Feed backoff & health metrics.** A feed that refuses us is stood down rather
  than retried (15 min for 403/401, 5 min for 429, doubling to a 6 h cap), and
  per-feed health — status, consecutive failures, stand-down expiry and the feed's
  own error message — is recorded to R2 and surfaced by `/api/history/health`.
  Before this, a blocked feed was asked 4×/minute indefinitely and nothing recorded
  why a day came back thin.
- **Ops workflow.** `.github/workflows/telemetry-health.yml` fetches any
  `/api/history/*` or route-diagnostic path from the deployed Worker, optionally
  summarising responses too large for a job log, and can probe a provider
  **directly** from the runner — which is how a block on the Worker's egress is
  told apart from a provider simply being down. It is the only way to reach the
  deployed Worker from an environment that cannot resolve `*.workers.dev`.
- **Incident-log review.** Import an incident-log CSV (or review your own saved log),
  scroll the list or view it on the map, and tap any entry to re-run the classifier and
  rules **at the logged time** — double-checking what the heuristics decided (owning
  airport with a *matches / differs from recorded* indicator, hours, arrival/departure,
  corridor inside/outside, route, recomputed flags). The CSV export now also captures
  track / category / speed / vertical rate / nav-alt / route / military so future logs
  support the full re-analysis.

## Develop

```bash
npm install
npm run dev            # front-end on http://localhost:5173
npm run worker:dev     # Worker on http://127.0.0.1:8787
```

The dev front-end targets the local Worker by default. Open `/spike.html` to run
the direct-fetch CORS test against the feed.

## Build & deploy

```bash
npm run build          # outputs ./dist (Vite base = /fight-or-flight/)
npm run worker:deploy  # wrangler deploy --config worker/wrangler.toml
```

Pushing to `main` triggers `.github/workflows/deploy.yml` (GitHub Pages). Set the
repo Actions variable `VITE_WORKER_BASE` to your deployed Worker URL so the built
site points at it. One-time setup steps are in the Phase 0 notes.

Alternatively the Worker can serve the PWA itself on a single custom domain
(`npm run build:anon` + `worker/wrangler.anon.example.toml`) — see
[`docs/ANONYMOUS-HOSTING.md`](./docs/ANONYMOUS-HOSTING.md) for that mode and the
full pseudonymous-hosting cutover guide.

## Layout

```
src/
  config/   airports (incl. Blackbushe), corridors (WebTrak swaths), rules,
            classification, calendar, filters, permits, types, api
            (all thresholds and the verified permit caps live here)
  lib/      adsb (Worker contract), classify, trajectory, rulesEngine, assess,
            complaint, geo, aircraft, log, incidentCsv, review, settings,
            history (D1 client), replay, historyComplaint, reviewRead
  components/  NearbyButton, FlightList/Card/Detail, MapView, FlagBadge,
               AirportTag, KindTag, ComplaintModal, IncidentLog,
               HistoryModal (stats/flights/replay/review), ReplayView,
               OffendersView, Review{Modal,Map,Detail}, Settings*
worker/
  src/index.ts   Cloudflare Worker: /api/nearby, route lookup + diagnostics,
                 /api/history/*, CORS
  src/capture.ts telemetry recorder (cron: capture → R2, compaction, feed health)
  src/rollup.ts  nightly sessionizer → D1 (flights, flags, daily stats)
  src/shared.ts  upstream feed access shared by proxy + recorder
  wrangler.toml  cron triggers + R2 and D1 bindings
docs/        BUILD-PLAN, TELEMETRY-CAPTURE-PLAN, PHASE-*-NOTES, DATA-RESEARCH,
             CORRIDOR-DATA-EXTRACTION, ASCENT-DESCENT-HEURISTIC,
             ANONYMOUS-HOSTING, data/ (captured WebTrak swaths)
public/spike.html  Phase 0 in-browser CORS spike
.github/workflows/  deploy.yml (Pages) · deploy-worker.yml (Wrangler)
                    telemetry-health.yml (ops: health, trends, feed probes)
```

## Feed usage & current status

Everything reaches the community feeds through the Worker, which is the single
choke-point in front of them.

- **Live app** — one point query per button tap, edge-cached ~8 s. No background
  polling by default; an opt-in auto-refresh exists in Settings (minimum 10 s).
- **Recorder** — one point query every 15 s (4/minute) for a single fixed query:
  `51.2758, −0.7763`, radius 25 nm. That is the whole of it; there is no crawling,
  no per-aircraft fan-out and no second region.
- One attempt per request, never an immediate retry.
- A feed that refuses is **backed off, not retried** — 15 min after a 403/401,
  5 min after a 429, doubling to a 6 h cap.
- Every upstream request carries a descriptive `User-Agent` naming this repo.

This is a personal, non-commercial project: the data is used to compare
Farnborough Airport's movements against its published planning conditions, and is
not resold, redistributed as a feed, or used to build a rival tracker.

**Why only adsb.lol.** adsb.lol publishes its data as **open data under ODbL** and
runs an open API, so systematically retrieving it to compile this archive is the use
that licence contemplates — with attribution, which the UI, the complaint text and
these READMEs carry.

**airplanes.live was removed on 20 August 2026, deliberately.** Their
[terms of use](https://airplanes.live/terms-of-use/) §4 prohibit systematically
retrieving data "to create or compile … a collection, compilation, database, or
directory without written permission", and separately prohibit "automated use …
data mining, robots, or similar data gathering and extraction tools". The recorder
is exactly that, so it was outside their terms from the day it started; the `403`
they began returning on 13 August was enforcement, not a rate limit. We stopped
asking rather than knocking more politely. Written permission would be needed to
use them this way, and re-adding them is a one-line change if it is ever granted.

Capture accordingly ran degraded from 13–20 August (~11,000 records/day against a
normal ~130,000), and Farnborough movement counts for those days understate
reality. Per-feed health is visible at `/api/history/health`.

## Data & attribution

Aircraft data from **[adsb.lol](https://adsb.lol)**, community open data under the
[ODbL](https://opendatacommons.org/licenses/odbl/); route enrichment via
[adsbdb.com](https://www.adsbdb.com) with [hexdb.io](https://hexdb.io) as fallback.
(airplanes.live was used until 20 August 2026 — see "Feed usage" above for why it
is not any more.)
Farnborough corridor geometry from **Farnborough WebTrak** (EMS Brüel & Kjær /
Envirosuite). All free / non-commercial, no uptime guarantee, used under their terms
with attribution. Free ADS-B feeds can miss very low or masked aircraft.
