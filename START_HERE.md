# fight-or-flight: start here

A mobile-first PWA (Vite + React + TypeScript + Leaflet) that lists the nearest aircraft to you, flags ones that look outside local airport rules (Farnborough / Heathrow / Gatwick) and prefills an editable complaint. Front-end on GitHub Pages, data via a Cloudflare Worker. Lately also a home ADS-B receiver.

| | |
|---|---|
| GitHub | https://github.com/kieranhj/fight-or-flight (public) |
| Local path | D:\misc\mine\fight-or-flight (moved from C:\Users\khcon\OneDrive\Projects\fight-or-flight on 2026-11-21) |
| Branch | `claude/adsb-receiver` (3 commits ahead of `main`); other branches below |
| Last commit | 2026-10-30: Record 1090MHz UK as live; its MLAT isn't open yet |

## What's in here
- `src/`: the PWA (`lib/adsb.ts`, `classify.ts`, `rulesEngine.ts`, `complaint.ts`, `log.ts`, `config/`).
- `worker/`: the Cloudflare Worker proxy (`worker/src/index.ts`, `wrangler.toml`). The `NormalizedFlight` type is duplicated here and in `src/lib/adsb.ts`: keep them in step.
- `receiver/`: laptop RTL-SDR test receiver (`adsb_local.py`, `compare.py`, `bin/` for rtl_adsb), with its own README.
- `docs/`: BUILD-PLAN.md (all phases done), PHASE-*-NOTES.md, RECEIVER-PLAN.md, corridor data.
- `scripts/gen-icons.mjs`, `public/`, `.github/` (Pages deploy workflow).

## Build and run
- `make`: `npm run build` (tsc -b + vite build into `dist\`, gitignored). Other targets: `make typecheck`, `make install`, `make help`.
- Needs Node/npm (`node_modules/` is present). Run locally with `npm run worker:dev` and `npm run dev` in two terminals (http://localhost:5173). Deploy the Worker with `npm run worker:deploy`.
- No tests or linter; `npm run typecheck` is the check.

## Local changes
- Uncommitted: `CLAUDE.md` is untracked (never committed), and `archive/` is untracked: about 150 MB (`foaf-history-2026-08-20.sql` 68 MB, `archive/archive/` 33 files 78 MB, `days.txt`).
- `wip/2026-11-tidy` (pushed): snapshot of the untracked `CLAUDE.md` from the 2026-11 tidy.
- Unmerged branches: `claude/adsb-receiver` (current, 3 ahead), `claude/add-blackbushe-airport` (3 ahead, 2026-06-29), `claude/blackbushe-fixes` (1 ahead). Remote-only: `origin/claude/aircraft-complaint-assistant-pwa-u9hfn0` (2026-07-26, single-origin Worker mode) and `origin/claude/ops-probe-nearby` (2026-08-31). Merged and safe to prune: `claude/docs-refresh`, `farnborough-trajectory-heuristic`, `light-icon-for-low-unknown`, `map-recenter-toggle`, `real-farnborough-corridors`.

## Status and next steps
- The PWA plan is complete (README "Status"). Recording was paused in Aug 2026 (docs/RECORDING-PAUSE.md).
- Current thread: the receiver branch (laptop test receiver scored against adsb.lol, Pi siting, 1090MHz UK feed). See docs/RECEIVER-PLAN.md. Merge it or carry on.
- Decide: commit CLAUDE.md; keep `archive/` out of git (it is large) or move it elsewhere.

## See also
- README.md, CLAUDE.md, docs/BUILD-PLAN.md, receiver/README.md, worker/README.md.
- D:\pico-esp32\mine\presto-air-traffic: the Presto desk display that uses this repo's rules and Worker.
