# Anonymous hosting — cutover guide

Goal: run Fight or Flight (PWA + Worker + recorder + data) so that identifying
the operator requires **determined digging or a legal request to a service
provider** — not a glance at a URL, a WHOIS lookup, or a repo commit.

Nothing is absolutely anonymous. The specific bar this setup meets:

| Who can link the site to you | How |
| --- | --- |
| Cloudflare | payment card + account email (legal request) |
| Domain registrar | payment / registrant records (legal request; see step 2 options) |
| Anyone else | only via mistakes — that's what this checklist prevents |

Two things this does **not** hide, be clear-eyed about both:

- **Complaints carry your real name and address** to the airport. That is
  inherent to complaining. This guide anonymises the *site operator*, not the
  *complainant*.
- **The app's content links old and new hosting.** Anyone who saw
  `<user>.github.io/fight-or-flight` will recognise the same app on the new
  domain. The old association also lives on in web archives and search caches.
  The point is to break the *live, casual* link, and to make sure the new
  hosting adds no fresh identity of its own.

The code side is already prepared (this repo):

- `npm run build:anon` — builds the PWA for a domain root with **relative**
  `/api/*` calls (no Worker hostname baked into the bundle).
- `worker/wrangler.anon.example.toml` — single-origin deploy template: the
  Worker serves the PWA *and* the API on one custom domain. `workers.dev` is
  disabled (the account name would be visible in it). The filled-in copy
  (`worker/wrangler.anon.toml`) is `.gitignore`d so your real domain and IDs
  can never be committed.
- The upstream User-Agent is generic (`fight-or-flight-monitor/1.0`) with an
  optional `CONTACT` var for an **alias** email — no repo URL, no username.

---

## Phase 0 — hygiene first (before creating anything)

Mistakes here silently rebuild the link no matter how careful the rest is.

1. **Dedicated browser profile** (or better, a separate browser): create a
   fresh profile used *only* for the anonymous accounts. Never log into your
   personal Google/GitHub/Cloudflare/email in it. This prevents cookie/session
   cross-contamination and accidental "logged in as kieranhj" moments.
2. **Alias email**: create a new address used only for this project — a
   Proton Mail account, or an alias service (SimpleLogin / addy.io). Do NOT
   set your personal address as recovery. If a service demands a phone number,
   prefer one that doesn't (Proton usually doesn't for basic accounts).
3. **Payment**: decide your level.
   - *Meets your stated bar*: your normal card at Cloudflare — payment records
     are only reachable by legal request. Simplest, recommended.
   - *Stronger*: crypto where accepted (Njalla takes it for domains; Cloudflare
     does not — card or PayPal only).
4. **Pick names that say nothing**: domain, worker name (`foaf` in the
   template), account handle. Nothing aviation-grudge-specific that narrows
   the operator pool, nothing reused from your other identities. Don't reuse a
   username you've used ANYWHERE else.

## Phase 1 — domain

Two good options; both keep your name out of public WHOIS:

- **Option A — Cloudflare Registrar** (~$10/yr, easiest): register the domain
  inside the new Cloudflare account (step 2 first, then come back). WHOIS is
  redacted by default; registrant data is held by Cloudflare and disclosed
  only under legal process. One provider holds everything (registrar + host),
  which is one legal-request target — simpler, slightly more concentrated.
- **Option B — Njalla** (~€15/yr, strongest): njal.la registers the domain
  *in their own name* and holds it for you — even the registrar records don't
  name you. Accepts crypto. Then point its nameservers at the Cloudflare zone
  (Cloudflare free plan gives you nameservers when you add the domain as a
  zone).

Either way: **verify WHOIS after registration** (`whois yourdomain.org`) —
you should see the registrar's privacy service, not your name.

## Phase 2 — new Cloudflare account

In the dedicated browser profile:

1. Sign up at dash.cloudflare.com with the alias email.
2. Add the domain as a zone (skip if using Cloudflare Registrar — it's added
   automatically). If Njalla: set the two Cloudflare nameservers at Njalla.
3. Subscribe to **Workers Paid** ($5/mo) — the recorder's compaction needs it.
   This is where your card enters; that's the accepted identity link.
4. Create the storage (any machine, logged in as the new account):
   ```bash
   npx wrangler login              # opens browser — use the dedicated profile
   npx wrangler r2 bucket create foaf-telemetry
   npx wrangler d1 create foaf-history   # note the printed database_id
   ```
   `wrangler whoami` should show the NEW account before you run these. If you
   also use wrangler with your personal account on the same machine, run the
   anonymous commands with a separate `CLOUDFLARE_API_TOKEN` env var (token
   created in the new account) instead of `wrangler login`, so credentials
   can't cross.

## Phase 3 — configure and deploy

On your machine, in this repo:

1. ```bash
   cp worker/wrangler.anon.example.toml worker/wrangler.anon.toml
   ```
   Fill in `__ANON_DOMAIN__` (e.g. `example.org`) and `__ANON_D1_ID__` (from
   `d1 create`). Optionally uncomment `CONTACT` with the **alias** email.
   The copy is gitignored — `git status` must NEVER show it.
2. Build and deploy (deploys are from your machine only — no CI, no GitHub in
   the serving path):
   ```bash
   npm run build:anon
   npm run worker:deploy:anon
   ```
3. First-visit checks on `https://yourdomain.org`:
   - the app loads at the domain root and installs as a PWA;
   - dev tools → Network: every API call is a **relative** `/api/*` request to
     the same origin — nothing to `workers.dev` or `github.io`;
   - `https://yourdomain.org/api/history/health` returns the recorder config
     (recording starts immediately on deploy — the crons are live).

## Phase 4 — migrate the recorded data (optional but recommended)

The history to date (R2 raw days + D1 summaries) is worth keeping. Order
matters: deploy the new Worker FIRST (phase 3) so there's no capture gap —
both recorders can run in parallel during the copy.

1. **R2** — copy bucket-to-bucket with rclone over the S3 API. Create an R2
   API token in EACH account (Object Read for old, Object Read & Write for
   new), then:
   ```bash
   rclone copy oldr2:foaf-telemetry newr2:foaf-telemetry --transfers 8
   ```
   (rclone remotes: type `s3`, provider `Cloudflare`, endpoint
   `https://<account_id>.r2.cloudflarestorage.com`.) Re-run once more at the
   end — it's incremental — to catch objects written during the first pass.
2. **D1** — export from the old account, import into the new:
   ```bash
   # old account credentials:
   npx wrangler d1 export foaf-history --remote --output foaf-history.sql
   # new account credentials:
   npx wrangler d1 execute foaf-history --remote --file foaf-history.sql
   rm foaf-history.sql
   ```
3. Spot-check on the new domain: History → Stats shows the recorded days;
   Replay plays a past day; `/api/history/offenders?days=30` matches the old
   Worker's output.

## Phase 5 — decommission the identifiable hosting

Only after phase 3+4 are verified:

1. **Old Worker**: delete it in the old Cloudflare dashboard (or at minimum
   delete the cron triggers). This stops the old recorder and kills the
   `aircraft-complaint-proxy.kieranhj.workers.dev` URL.
2. **GitHub Pages**: repo → Settings → Pages → disable. The
   `github.io/fight-or-flight` URL should 404.
3. **This repo**: make it **private** (Settings → General → Danger Zone).
   The full git history carries your name/email in every commit and this very
   guide correlates with the cutover — private is the correct end state.
4. Old account data: keep the old R2 bucket/D1 until you've trusted the new
   setup for a week or two, then delete them (and downgrade the old account
   from Workers Paid so you're not paying twice).

## Phase 6 — republishing the code publicly (optional)

If you want the code public again without the identity:

1. Create a fresh GitHub account (dedicated profile, alias email, unused
   handle).
2. Publish a **fresh single-commit repo** — never push this repo's history:
   ```bash
   git archive HEAD | tar -x -C /tmp/foaf-clean   # exports files, not history
   cd /tmp/foaf-clean && git init
   git -c user.name="<handle>" -c user.email="<handle>@users.noreply.github.com" \
       commit -am "Initial import"
   ```
3. Before pushing, audit the export (see leak checklist below) and remove
   anything you don't want public — e.g. docs that describe your local area in
   detail, or this guide.
4. Set the new account's commit email to the noreply address and enable
   "Block command line pushes that expose my email".

## Leak checklist

Run before every anonymous deploy, and on any tree you're about to publish:

```bash
# Nothing identifying in the shipped bundle:
npm run build:anon
grep -riE 'kieranhj|github\.io|workers\.dev' dist/ && echo LEAK || echo bundle clean

# The filled-in config can't be committed:
git check-ignore worker/wrangler.anon.toml && echo ignored-ok

# Nothing identifying staged for commit:
git diff --cached | grep -iE 'kieranhj|yourdomain|your-alias' && echo LEAK || echo diff clean
```

And the habits that matter more than any grep:

- Anonymous accounts only ever touched from the dedicated browser profile.
- `wrangler whoami` before every deploy — right account?
- The real domain never appears in this repo, in commit messages, in issues,
  or in screenshots you share.
- Don't link the new domain from anything tied to you (personal social media,
  the old repo, forum posts under your name) — and don't complain *about* the
  site being yours anywhere public.
- If you later want CI deploys, that means putting the new account's API token
  in a GitHub repo — use the pseudonymous account's private repo only, never
  this one.

## What stays the same

- $5/mo Workers Paid + ~$10–15/yr domain. No other costs.
- The app itself: recording cadence, History, replay, offenders, complaints —
  identical. Complaint emails still come from your own mail client with your
  real details, by design.
- Local dev is untouched: `npm run dev` + `npm run worker:dev` work as before;
  the standard `npm run build` / GitHub Pages path also still works until you
  decommission it.
