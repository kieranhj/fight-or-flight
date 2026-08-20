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

There are two independent copies to take, and one thing wrangler cannot do.

**Wrangler has no `r2 object list`** (checked against 3.114.17 — `get`, `put` and
`delete` are the only object verbs). So there is no way to ask the bucket what it
holds; the day list has to come from somewhere else. Use the recorder's own
summaries, which is the list that matters anyway:

```bash
# Your deployed Worker URL — the same one .github/workflows/telemetry-health.yml
# curls, and the same VITE_WORKER_BASE the built site points at.
W=https://aircraft-complaint-proxy.<account>.workers.dev

# The day list: every day D1 has a summary row for.
curl -s "$W/api/history/stats?from=2026-07-19&to=2026-08-20" \
  | python3 -c 'import json,sys; [print(d["day"]) for d in json.load(sys.stdin)["days"]]' \
  > days.txt

# ...plus the LAST day, which will NOT be in that list. See below.
grep -qx 2026-08-20 days.txt || echo 2026-08-20 >> days.txt

wc -l days.txt          # expect 33: 19 Jul - 20 Aug inclusive
```

> **The final day is always missing from the stats list, by construction.**
> `daily_stats` rows are written by the nightly rollup at 00:15 UTC *the
> following day*. Pausing the crons stops that rollup, so the day capture
> stopped on never gets a summary row — and therefore never appears in
> `days.txt`. The raw telemetry for it is fine and still in R2; only the
> summary is absent. Always append the pause date by hand, as above, and see
> "Finish the final day" below for making D1 agree.

### 1. D1 — the distilled record

Small, and the one to keep if you keep only one. It is what every History screen
reads: flights, rule flags, daily stats.

```bash
npx wrangler login
npx wrangler d1 export foaf-history --remote --output foaf-history-2026-08-20.sql
```

### 2. The raw tracks — the irreplaceable part

Two ways. **Prefer the first**: it needs no Cloudflare credentials at all, works
from any machine, and tells you day-by-day whether the data is actually there.

```bash
# A. Via the Worker (no credentials). One NDJSON file per day.
mkdir -p archive
while read -r d; do
  if curl -sf "$W/api/history/day/$d" -o "archive/$d.ndjson"; then
    gzip -f "archive/$d.ndjson"
    echo "ok   $d"
  else
    echo "MISS $d"      # 404 = no capture recorded for that day
  fi
done < days.txt
```

```bash
# B. Byte-exact R2 originals (needs `wrangler login`). Note there is NO --remote
#    flag on `r2 object get` — remote is the default and --local is the opt-in,
#    which is the reverse of `d1 export`.
mkdir -p archive-r2
while read -r d; do
  y=${d%%-*}; m=$(echo "$d" | cut -d- -f2); dd=${d##*-}
  npx wrangler r2 object get "foaf-telemetry/raw/$y/$m/$dd.ndjson.gz" \
    --file "archive-r2/$d.ndjson.gz" || echo "MISS $d"
done < days.txt
```

### 3. Check what you got

```bash
ls -la archive/
find archive -type f -size -1k                 # any tiny file is a failed download
zcat archive/2026-08-01.ndjson.gz | head -2    # should be JSON position records
```

`-type f` matters: without it `find` also matches the directory itself and you
get a hit that looks like a failure but is not.

A day listed in `days.txt` but missing here is worth a second look. A day that is
absent from both is legitimately absent — the recorder went live mid-evening on
19 July, and the last day (20 August) stops at 19:57 UTC.

Method A gives decompressed-then-recompressed NDJSON rather than the original R2
object, so the bytes will not match B. The *content* is the same and it is what
the replay view consumes. Take both if you want belt and braces; take A if you
only take one.

Note that method B will **MISS the final day** even though method A gets it: the
day compaction that writes `raw/YYYY/MM/DD.ndjson.gz` also never ran. Method A
works because `/api/history/day/…` falls back to merging the `hour/` and
`minute/` staging objects when no compacted file exists — the same live-merge
path the replay view uses for "today".

### 4. Finish the final day

Optional, but it makes D1, the app and the archive agree with each other. Without
it the History tab shows nothing for 20 August while `RECORDING_END` claims the
archive covers it, and the D1 dump has no flights or flags for that day.

Both endpoints are idempotent GETs on your own Worker, and both still work while
paused — only `captureMinute()` is gated. **The order is mandatory**: `rollupDay`
reads the compacted day file and throws `no day file for … (has it been compacted
yet?)` if compaction has not run.

```bash
curl -s "$W/api/history/compact?day=2026-08-20"   # hour/ + minute/ -> raw/…gz
curl -s "$W/api/history/rollup?day=2026-08-20"    # raw/…gz -> D1 flights/flags/stats

# Confirm the row now exists, then re-take the D1 dump so it includes that day.
curl -s "$W/api/history/stats?from=2026-08-20&to=2026-08-20"
npx wrangler d1 export foaf-history --remote --output foaf-history-2026-08-20.sql
```

If you skip this, set `RECORDING_END` to `'2026-08-19'` in
`src/config/permits.ts` instead, so the app stops claiming a day it cannot show.

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

The code is intact and tested; restarting is a revert, not a rebuild. But do not
simply uncomment the crons — **the polling rate has to change too**, and that is
not a nicety.

### Why 4 requests/minute is no longer viable

The final health check before the pause (`/api/history/health`, 2026-08-20
21:39 UTC) caught something the daily stats never showed:

```
"adsb.lol": {
  "ok": false, "status": 429, "consecutiveFailures": 5,
  "lastOkAt": 1787255838,      // 19:57 UTC — the last good sample
  "lastFailAt": 1787260375,    // 21:12 UTC
  "backoffUntil": 1787265175,  // 80 min stand-down (5 min doubled 4x)
  "note": "429 Too Many Requests (nginx)"
}
```

adsb.lol had begun rate-limiting the recorder at its normal cadence — a single
point query every 15 s. The last recorded minute took **2 of 4** expected
samples. So by the end, the constraint was not only *how much the feed could
see*, it was *how often we were allowed to ask*. A restart at 4/minute would
walk straight back into this.

(The backoff from PR #59 handled it correctly — five refusals cost five requests
and an 80-minute stand-down rather than thousands of retries. That machinery is
worth keeping whatever the new rate is.)

### The order to do it in

Only worth starting once the coverage problem is solved, which in practice means
a receiver:

1. **Put up an ADS-B receiver and feed adsb.lol.** This is the actual fix. A
   receiver near the airport sees the low and masked traffic a distant community
   feeder cannot, and feeding adsb.lol improves the feed this project is licensed
   to use — for us and for anyone else looking at EGLF. One receiver can feed
   several aggregators at once.
2. **Read from the receiver, not the aggregator.** A local dump1090 serves
   `/data/aircraft.json` on the LAN with no rate limit and no third party — poll
   *that* as the primary and treat adsb.lol as a sparse fallback or drop it from
   capture entirely. This also removes the reason the 429s appeared. It does mean
   the receiver pushes records outward rather than the Worker pulling them, which
   is a real architecture change: `captureMinute()` currently assumes it can
   fetch, and would become an ingest endpoint instead.
3. **If you do keep polling a public aggregator, slow down.** 4/minute drew a
   429; something like 1/minute is the place to start, and `SAMPLES_PER_MINUTE`
   in `worker/src/capture.ts` is the single knob. Watch `/api/history/health`
   for a week before trusting it — `consecutiveFailures` climbing means the rate
   is still too high, and `attempted` vs `expected` in `state/last.json` shows
   partial minutes rather than hiding them.
4. **Measure before trusting.** Run capture for a fortnight and compare daily
   movements against 137/day. If it is still landing near 100, the count is still
   not defensible and the honest thing is to keep using the data for incidents
   only.
5. Restore Workers Paid (compaction needs more than the free 10 ms CPU).
6. Uncomment `[triggers]`/`crons` in `worker/wrangler.toml`, delete the
   `RECORDING_PAUSED` var, redeploy.
7. Set `RECORDING_END` back to `null` in `src/config/permits.ts`. This is what
   restores the live-mode History UI: the banner disappears, the 14-day chart
   re-anchors on today, "Today · so far" comes back in the replay picker, and new
   incidents become replay-jumpable again.
8. Confirm `/api/history/health` shows `recording: true`, a `lastCapture` within
   five minutes, `attempted` equal to `expected`, and no feed in backoff.

Note the discontinuity that will exist in the data either way: pre-13-August days
came from a denser feed, 13–20 August from adsb.lol alone (and rate-limited by
the end), and post-restart days from a receiver at whatever new cadence you
choose. Three coverage regimes and two sampling rates in one table. Compare days
within a regime, not across them — the History tab's own footnote says the counts
are minimums for exactly this reason.
