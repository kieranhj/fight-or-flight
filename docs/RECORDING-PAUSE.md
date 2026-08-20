# Recording paused — why, and how to restart it

**Status: paused since 2026-08-20.** The archive (19 July – 20 August 2026) is
kept and stays browsable in the History tab. Live identification — the thing the
app is actually for — is unaffected and has no dependency on any of this.

## Why it stopped

The recorder existed to count Farnborough movements against its planning caps:
50,000 a year, and 8,900 on weekends and bank holidays. 50,000 a year averages
**~137 movements a day**.

Our best window — 28 July to 12 August, after the airshow exclusion and while the
denser feed was still available — measured **~100 a day**. So even at full health
we were seeing roughly three-quarters of the traffic, and a partial count has an
asymmetry that no amount of tidying fixes: it can fail to show a breach, but it
can never demonstrate one. Anyone on the receiving end of a complaint only has to
ask what coverage the figure is based on.

Losing airplanes.live on 13 August (see the top-level README) took daily capture
from ~130,000 records to ~11,000 and movements from ~100 to ~60. That exposed the
problem rather than causing it.

None of this affects the per-incident use, which is where the evidence was always
strongest: *this* aircraft, at *this* time, at *this* altitude, in or out of the
published corridor. That comes from a single live query at the moment you hear
it, and needs no archive at all.

## What "paused" means

| | State |
|---|---|
| Cron triggers | Commented out in `worker/wrangler.toml` |
| `RECORDING_PAUSED` var | `"2026-08-20"` — `captureMinute()` refuses to run, `/api/history/health` reports `pausedSince` |
| R2 bucket `foaf-telemetry` | **Kept.** Raw day files, hour files, state objects |
| D1 `foaf-history` | **Kept.** `flights`, `flight_flags`, `daily_stats` |
| Read endpoints | **All still work** — flights, stats, replay, offenders |
| History tab | Shows a "Recording paused" banner and the archive's date range |
| Live identification | Unaffected |

Two locks rather than one: the crons are off, *and* the env var makes capture
refuse. Either alone would do, but a stray trigger or a manual invoke appending a
single minute to a frozen archive months later is a nasty thing to debug.

## Before changing anything on Cloudflare: export the archive

Do this **first**, and confirm the files are somewhere that is not Cloudflare. A
plan downgrade is a bad moment to discover what it takes with it.

```bash
# 1. D1 — the distilled record (small; the one to keep if you keep only one)
npx wrangler d1 export foaf-history --remote --output foaf-history-2026-08-20.sql

# 2. R2 — the raw day files, the irreplaceable part.
#    List first so you know what you are expecting, then pull each day.
npx wrangler r2 object get foaf-telemetry --remote --prefix raw/ --list
for d in $(seq -w 19 31); do
  npx wrangler r2 object get "foaf-telemetry/raw/2026/07/$d.ndjson.gz" \
    --remote --file "archive/2026-07-$d.ndjson.gz" || true
done
for d in $(seq -w 01 20); do
  npx wrangler r2 object get "foaf-telemetry/raw/2026/08/$d.ndjson.gz" \
    --remote --file "archive/2026-08-$d.ndjson.gz" || true
done

# 3. Check what you got — roughly a file per day, none of them zero bytes
ls -la archive/
```

Expect ~33 day files. Days before compaction ran, or days with no capture, are
legitimately absent — cross-check against the Stats tab's "days recorded" count
rather than assuming a gap is a failed download.

**Do not delete the R2 bucket or the D1 database.** They cost nothing at this
size, they are the only copy of what partial coverage looked like around EGLF
before the shutdown, and they are the baseline any future receiver data gets
compared against.

## Turning off the $5/month

Pausing the crons does not reduce the bill. That needs a downgrade to the Workers
Free plan, and the free plan is a different environment — do it in this order and
confirm at each step, because the failure mode is a silently broken app.

1. **Export the archive** (above). Non-negotiable, and not reversible if skipped.
2. **Deploy the pause** — `npm run worker:deploy` with the crons commented out.
   Confirm `/api/history/health` reports `pausedSince: "2026-08-20"` and that
   `recording` is `false`.
3. **Use the app for a day on the paid plan.** Identification, History, replay.
   This separates "the pause broke it" from "the downgrade broke it" — you want
   those to be two answers, not one.
4. **Downgrade to Workers Free** in the Cloudflare dashboard.
5. **Re-verify immediately**: `/health`, then `/api/nearby`, then the History
   tab. `/api/nearby` should be well inside the free tier — its cost is mostly
   waiting on the upstream fetch, which does not count as CPU time — but the
   **R2 and D1 bindings on the free plan are the open question**. If a bound
   resource is unavailable there, the deploy or the read endpoints will fail, and
   the fix is to drop the History features from the front-end rather than to
   restore the archive from backup in a panic.

If step 5 goes badly, going back up to Paid is immediate and the archive is
untouched — which is the whole reason for exporting at step 1 and not at step 6.

## Restarting it

The code is intact and tested; restarting is a revert, not a rebuild. But it is
only worth doing when the coverage problem is solved, which in practice means a
receiver:

1. **Put up an ADS-B receiver and feed adsb.lol.** This is the actual fix. A
   receiver near the airport sees the low and masked traffic a distant community
   feeder cannot, and feeding adsb.lol improves the feed this project is licensed
   to use — for us and for anyone else looking at EGLF. One receiver can feed
   several aggregators at once.
2. **Measure before trusting.** Run capture for a fortnight and compare daily
   movements against 137/day. If it is still landing near 100, the count is still
   not defensible and the honest thing is to keep using the data for incidents
   only.
3. Restore Workers Paid (compaction needs more than the free 10 ms CPU).
4. Uncomment `[triggers]`/`crons` in `worker/wrangler.toml`, delete the
   `RECORDING_PAUSED` var, redeploy.
5. Set `RECORDING_END` back to `null` in `src/config/permits.ts`. This is what
   restores the live-mode History UI: the banner disappears, the 14-day chart
   re-anchors on today, "Today · so far" comes back in the replay picker, and new
   incidents become replay-jumpable again.
6. Confirm `/api/history/health` shows `recording: true` and a `lastCapture`
   within five minutes.

Note the discontinuity that will exist in the data either way: pre-13-August days
came from a denser feed, 13–20 August from adsb.lol alone, and post-restart days
from adsb.lol plus a local receiver. Three coverage regimes in one table. Compare
days within a regime, not across them — the History tab's own footnote says the
counts are minimums for exactly this reason.
