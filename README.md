# Ouahad Hackathons

A local catalog for Moroccan hackathons and international events with an online option. Imports propose drafts or revisions; only an explicit owner decision makes a revision visible in public reads. Phase 2 uses the Cloudflare D1 binding in Miniflare (workerd), with no Cloudflare account or remote database required. See [the product design](docs/product-v1.md).

## Production launch

The Worker, assets, dedicated production D1 and daily discovery Cron are live at [hackathons.ouahad.space](https://hackathons.ouahad.space). The launch catalog has three reviewed real entries with AR/FR/EN summaries. Signed-in Google users can verify a delivery address and opt into accepted-stage reminders through Resend. Email-code sign-in remains disabled. See [the production email rollout](docs/production-email-rollout.md) for the real mailbox checks, independent schedules and operational commands.

See [the launch guide](docs/launch.md) for exact PowerShell commands, current verification, official launch evidence, six active discovery sources, the DNS-preserving move, Google setup and remaining production checks. Builds require Node 24.22.0 or a supported newer release; use `npm.cmd ci`, `npm.cmd run test:production`, and `npm.cmd run build`. Normal local previews retain their existing stores; the built Worker preview uses a separate store.

## Browser previews

From the workspace root, with Node.js 24 or newer:

```powershell
npm.cmd ci
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\start-preview.ps1 -Mode Empty
```

Open [the empty catalog](http://127.0.0.1:4173). In a second PowerShell window:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\start-preview.ps1 -Mode Demo
```

Open [the populated catalog](http://127.0.0.1:4174) or [its archive](http://127.0.0.1:4174/archive). The script seeds a draft-only database for the empty preview, and publishes seven real Phase 1 editions through the owner CLI in a different demo database. Neither command changes the default catalog in `.local/d1`. Stop previews with Ctrl+C before running more CLI commands against their stores. The demo uses the current clock, so a time-sensitive listing may move to the archive.

To preview an already migrated store directly, set `$env:OUAHAD_D1_PATH` to its path (or leave it unset for the default), then run `npm.cmd run preview -- --port 4173`.

The agenda uses the Ouahad Space visual system and offers English (the default), French (`?lang=fr`), and Arabic (`?lang=ar`). Language switches retain the listing or active filters. Search and filter values live in the URL, applied filters can be removed individually, and the detail page’s return link restores the same result view. Arabic pages use RTL with isolated official names and source text. Official names, field names, cities, and organizer notes remain as published; interface copy and dates are localized. Date-only values never acquire a time.

## Private My Hackathons

Production uses Google sign-in. Address verification never creates or merges an account, and reminders remain off until that account verifies an address and explicitly opts in. Local code and reminder outboxes remain development tools and are unavailable in production. The phase descriptions below record their original implementation scope; the [production rollout guide](docs/production-email-rollout.md) supersedes their delivery status.

Phase 7A prepares a default-disabled Resend adapter for live codes, address verification and accepted-stage reminders. Google and the local outboxes are preserved. See [sender setup, owner-only smoke commands, secrets, budgets and verification](docs/phase7a.md). No live email, DNS change, external account, billing change or deployment was performed.

Phase 6B adds default-off accepted-stage reminders, account-bound delivery-address verification, queue status on the personal agenda, and a separate local reminder outbox. See [the reminder guide](docs/phase6b.md) for timing, cancellation, exact PowerShell commands and verification. No email is sent, and the source-sync schedule is unchanged.

The private area now has a personal agenda, status filters, milestone progress and one save action per stage with date/time controls. Google sign-in is preserved. A separate email-code flow is available **only with captured local delivery**, using `EMAIL_SIGNIN_MODE=capture` in a configured Node development preview; it never sends live messages or links Google accounts by email. See [the private account redesign and verification guide](docs/private-account-redesign.md) for the comparison gallery, commands, data preservation checks and production delivery work.

Phase 6A adds prepared Google OIDC authentication alongside this local demo flow. See [provider setup, current free-tier comparison, security boundaries and verification](docs/phase6a.md). No Google OAuth client has been provisioned and no real Google login has been claimed. Production auth is disabled until explicitly configured; missing credentials never enable Aya or Sami.

To exercise the full redirect/callback flow without an external account:

```powershell
$env:NODE_ENV = 'development'
npm.cmd run preview:auth-test
```

Open [the test-provider preview](http://127.0.0.1:4177/my). Its clearly labeled fake issuer uses Test account One/Two and a separate local D1 store. To use real Google credentials after completing the owner setup in `docs/phase6a.md`, copy `.env.auth.example` to `.env.auth.local`, fill it locally, then run:

```powershell
node --env-file=.env.auth.local src/cli.ts migrate
node --env-file=.env.auth.local src/cli.ts seed
npm.cmd run preview:google
```

Both provider previews use port 4177; run one at a time. The original Phase 5 flow remains available:

```powershell
# Isolated D1 demo: seven real CLI-approved editions, Aya and Sami test sign-in.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\start-private-preview.ps1 -Mode Demo -Port 4175
# Separate empty catalog with the same private flow (run in another terminal).
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\start-private-preview.ps1 -Mode Empty -Port 4176
```

Open [My Hackathons](http://127.0.0.1:4175/my) and choose **Aya** or **Sami**. Use separate browser profiles for simultaneous accounts. Save a published edition or add an external opportunity privately, then track application, decision, attendance plan, attendance and result independently per stage. Organizer links never mark an application as submitted. Stage conflicts appear before acceptance and update from approved schedules; declining attendance removes a stage from active conflicts without clearing history. All new screens support English, French and Arabic.

Both `NODE_ENV=development` and `OUAHAD_DEV_AUTH=1` are required for these demo identities; the script sets them for its process only. The Node server is loopback-only. This freely selectable identity flow is deliberately unavailable outside local development and is not production authentication. No private entry can become a catalog listing. See [Phase 5 behavior and browser story](docs/phase5.md). The normal migration command now also applies `0004_provider_auth.sql`, preserving demo ownership and adding separate provider identities/sessions. No sync schedule changed.

## Run in PowerShell

From the workspace root, with Node.js 24 or newer:

```powershell
npm.cmd ci
npm.cmd run catalog -- migrate
npm.cmd run catalog -- seed
npm.cmd run catalog -- review list
npm.cmd run catalog -- list all
```

`seed` replays the six manual examples and four captured feed entries from November 17, 2026. It adds missing editions without changing existing proposals or approvals and does not claim a new live verification. A fresh database has ten drafts and no public listings. The store defaults to `.local/d1`; set `$env:OUAHAD_D1_PATH` for an isolated store. The Phase 1 JSON store is left untouched.

```powershell
npm.cmd run catalog -- import
npm.cmd run catalog -- sync
npm.cmd run catalog -- review candidates
```

`import` reads the six reference examples or a supplied file. `sync` monitors the six enabled sources in [the discovery registry](data/discovery-sources.json), including UCA, Hack Club, GitHub Gaming, FST Fès, HCP and Technopark. UCA and Hack Club apply facts from [data/source-reviews.json](data/source-reviews.json); GitHub supplies discovery candidates only. Candidates without organizer review cannot be published. For UCA and Hack Club, add verified facts keyed by the source ID, then sync again; use manual intake for GitHub candidates after checking for an existing edition. Failures return a nonzero exit code and preserve stored and approved editions. Do not open multiple local runtime processes against the same D1 directory; overlapping jobs within one runtime are protected by source leases.

## Daily sync and source monitoring

Stop a browser preview before operating on its local store. For an isolated sync store (or omit the environment variable to use the normal owner database):

```powershell
$env:OUAHAD_D1_PATH = '.local/d1-sync'
npm.cmd run catalog -- migrate
npm.cmd run catalog -- seed
npm.cmd run catalog -- sync
npm.cmd run catalog -- sync-status
npm.cmd run catalog -- review list
npm.cmd run catalog -- review candidates
```

`sync` and the Worker scheduled handler both call `runDailySync`. The intended schedule in [cloudflare.config.ts](cloudflare.config.ts) is **06:00 UTC daily** (`0 6 * * *`); Morocco's seasonal time changes do not move it. Nothing is scheduled on the user's computer and no remote job has been activated. To invoke the real bundled handler in local workerd:

```powershell
npm.cmd run catalog -- sync-scheduled
# Supplying a timestamp makes the simulated scheduled delivery replayable.
npm.cmd run catalog -- sync-scheduled '2026-11-17T06:00:00Z'
npm.cmd run catalog -- sync-inspect 'scheduled:0 6 * * *:1794895200000'
```

For a manual run, capture its returned ID for inspection:

```powershell
$run = npm.cmd --silent run catalog -- sync | Out-String | ConvertFrom-Json
$run.sources | Format-Table source, outcome, new_drafts, proposed_changes, unchanged_records, new_candidates
npm.cmd run catalog -- sync-inspect $run.id
npm.cmd run catalog -- sync-status
```

Each source records start/finish timestamps, duration, fetch attempts, outcome and counters. `success` with zero new records is a healthy no-change run. `failed` keeps the error and does not advance the last success; `stale` means no monitored success within 48 hours. Monitoring also lists missing reviewed IDs, raw candidate discoveries, disagreements between observed and reviewed fields, and organizer evidence more than 30 days old. A feed fetch never renews the organizer's review timestamp.

`new_drafts` counts newly materialized editions, `proposed_changes` counts revisions to existing editions, and `unchanged_records` counts normalized records that produced no revision. Unverified discoveries are counted separately as `new_candidates`: they stay in `review candidates` until the owner supplies evidence. The schedule never calls publish, reject or withdraw.

Per-source leases last two minutes; overlapping runs record `skipped-overlap` rather than fetching the same source twice. A commit checks its lease inside the D1 transaction so an expired runner cannot overwrite a newer observation or proposal. Scheduled delivery IDs deduplicate retries of the same cron timestamp. A new manual run gets a new ID and can retry failed sources. Interrupted runs are reported as `abandoned` after lease expiry and the next run can reclaim the source. Counts and successful source results commit with the imported proposals. Run and revision history is retained locally.

Network errors, HTTP 408/429 and server errors get at most three attempts (8-second timeouts with 250/500 ms backoff). Invalid feeds and permanent HTTP errors are reported without repeated parsing. Responses are capped at 2 MiB. A source failure leaves other sources running independently, preserves approved versions, and does not stop read-time registration cutoffs.

## Owner review and public reads

```powershell
$edition = 'add-open-data:hackathon-open-data-2026'
npm.cmd run catalog -- review list
npm.cmd run catalog -- review inspect $edition
$entry = npm.cmd --silent run catalog -- review inspect $edition | ConvertFrom-Json
npm.cmd run catalog -- publish $edition $entry.pendingId
npm.cmd run catalog -- list all
npm.cmd run catalog -- list open morocco
npm.cmd run catalog -- list archive
```

Inspect the pending revision before publishing. An approval names the exact revision you reviewed; a superseded ID is refused. Reimporting identical facts does not create a new revision. A changed proposal shows up alongside the previous approval until explicitly published. The pending proposal and last source observation are separate from the approved facts.

`npm.cmd run catalog -- reject $edition $entry.pendingId "Reason"` rejects a **pending** draft or update; a rejected update leaves the current publication visible. `npm.cmd run catalog -- withdraw $edition "Reason"` hides a published edition from all public views and preserves its history. Only a later explicit approval of a pending revision can publish it again. Owner operations exist only in the local CLI. The browser reads approved data via `GET /`, `GET /archive`, and `GET /hackathons/:id`. A nonpublic detail returns 404. The public catalog has no HTTP write API or separate frontend dataset. Phase 5's optional local private forms write only to their signed-in owner's private records.

## Add or update an opportunity

Save a UTF-8 JSON array, for example `data/my-listings.local.json`, then run:

```powershell
npm.cmd run catalog -- import data/my-listings.local.json
```

Use [data/references.json](data/references.json) as a template. Each entry needs a lowercase organizer key (`source`), a stable ID for that edition (`externalId`), a title, an official `eventUrl`, a `category` (`morocco` or `international-online`), a `format` (`in-person`, `online`, `hybrid`, or `unknown`), and a `review` with the evidence URL and the actual time you checked it. Add an `organizer` name where the official evidence names one. Morocco entries need `countryCode: "MA"`; international entries need an online option. Keep the source key and external ID unchanged when you edit an edition. Reimport the complete entry: omitted fields return to their defaults. Use a new ID for a new edition. Identity is scoped to the source; check for a preexisting listing before adding the same event from a second organizer feed.

Dates can be `YYYY-MM-DD` or ISO timestamps with an explicit offset. Set `timeZone` to a named zone such as `Africa/Casablanca` when the date refers to that zone. Omit anything the organizers did not publish. Keep event dates, the last day to apply, and the project cutoff in their respective fields. For a deadline that depends on the team’s location, or conflicting organizer times, put the source wording in `submissionDeadlineNote` and leave the timestamp empty. Keep separate application and rules URLs where published. A known registration status or eligibility decision needs evidence; online format, future dates, and links to forms do not establish either on their own.

For documented rounds, supply a `stages` array with a stable `key`, `name`, evidence `evidenceUrl`, and `entry` (`direct` or `advancement`). Advancement names an earlier `requiresStage` key. Supply each stage's own dates, application status and eligibility when known; missing dates and status stay unknown. The existing ten records each have one unnamed event window. See the [D1 integration test](test/d1.test.ts) for a synthetic qualifier and final example.

The public `open` view requires an approved, direct application route with verified open registration and confirmed Morocco eligibility. After 30 days without organizer review, an open claim becomes unknown; a new feed fetch does not refresh that review. Date-only cutoffs last through their calendar day in the named zone (or until the date has passed everywhere if no zone is known). Timed cutoffs take effect at the published instant. The archive includes `applications-closed` and `finished` editions, including events with closed applications and a future start date. A submission cutoff alone never closes applications. Reads do not mutate stored dates or delete rows.

## Sources and evidence

- **Automated, Morocco:** [Cité de l’Innovation UCA RSS](https://cim.uca.ma/feed/), advertised on the [university center’s site](https://cim.uca.ma/). The importer reads the post title, GUID and official link. It finds candidate titles containing “hackathon”; dates, format, registration and eligibility come from manual review. RSS publication dates are news dates.
- **Automated, international:** [Hack Club Events API](https://hackclub.com/api/v1/events), documented in its [OpenAPI contract](https://hackclub.com/api/openapi.yaml). The importer reads retained event IDs, title, website, online format and program start/end. Discovery looks for hackathons or jams among explicitly online programs; many API programs are individual build challenges or online qualifiers for an in-person event. Program dates and status do not establish application or submission deadlines. Organizer rules and application status are checked separately.
- **Automated discovery, international:** [GitHub Gaming RSS](https://github.blog/open-source/gaming/feed/) is advertised by the [official gaming blog](https://github.blog/open-source/gaming/). The daily job records Game Off announcements for review and skips titles marked winners/results. It does not extract event dates, eligibility or registration status from article text. Check candidates against existing editions before manual intake to avoid duplicating the manually entered Game Off 2026 listing. On November 17, the real local scheduled handler successfully retrieved three announcement candidates. The older tag feed did not include the current edition and was not enabled.
- **Tested, unsuitable for this announcement:** [data.gov.ma RSS](https://www.data.gov.ma/fr/rss.xml) responded but did not contain the current Open Data hackathon call. Its organizer announcement and form were reviewed manually. Other organizer links below were also used as manual evidence. Devpost appears only as a registration link supplied by an organizer.

| Draft | Category | Import and verification evidence |
| --- | --- | --- |
| Water4Future, 3rd edition | Morocco | UCA RSS GUID `?p=5562`; the [official form](https://www.uca.ma/forms/water4future/candidatures) confirms dates, Moroccan university eligibility, and the Nov 4 registration cutoff. |
| Mémoire, Patrimoine, Innovation & Investissement | Morocco | UCA RSS GUID `?p=5426`; [official call](https://cim.uca.ma/wp-content/uploads/2026/03/Appel-a-participation-Hackathon-Memoire-Patrimoine-Innovation-Investissement.pdf) specifies March 24 for applications and April 3–4 for the hackathon. |
| Radish Jam | International online | Hack Club API ID `recDFXvSpx4603YEa`; [organizer FAQ](https://radish.hackclub.com/) confirms location is unrestricted for entrants age 18 or younger. |
| Ember | International online | Hack Club API ID `rec8Rl8byVdqM6Yuk`; [organizer rules](https://ember.hackclub.com/) and [entry page](https://itch.io/jam/ember) disagree on the cutoff. Morocco eligibility remains unknown. |
| Hackathon Open Data 2026 | Morocco | Manual: [ADD call](https://www.data.gov.ma/fr/actualites/lancement-de-la-3eme-edition-du-hackathon-open-data-21-22-decembre-2026-rabat), [form](https://data.gov.ma/fr/candidature-hackathon) and [rules](https://data.gov.ma/sites/default/files/hackathon/reglement-hackathon-open-data-2026.pdf). |
| TechNovate Hackathon — Blue Tech | Morocco | Manual: [Ibn Zohr faculty notice](https://fsa.uiz.ac.ma/news/251d422a-ad8c-49ac-9466-94688d8d6774) confirms dates and links the form. The [microsite](https://technovate-hackathon.ma/) returned HTTP 509; status and eligibility stay unknown. |
| Think AI Morocco 2024 | Morocco | Manual: [organizer archive](https://thinkai.ma/) has the schedule, participating audience and final report slot. |
| NASA Space Apps Challenge 2025 — Universal Event | International online | Manual: [NASA announcement](https://www.nasa.gov/nasa-space-apps-challenge-2025/) and [Universal Event page](https://www.spaceappschallenge.org/2025/local-events/universal-event/) confirm dates and participation from anywhere. Submission depends on the team creator’s time zone. |
| United Hacks v8 | International online | Manual: [Hack United](https://unitedhacks.hackunited.org/) explicitly accepts entrants from any country aged 13+. Its published submission cutoff is separate from the unknown registration cutoff. |
| GitHub Game Off 2026 | International online | Manual: [organizer announcement](https://github.blog/open-source/gaming/game-off-2026-the-theme-is-shift/) and [entry page](https://itch.io/jam/game-off-2026) show the submission window and joining instructions. Edition-specific geographic eligibility remains unknown. |

## Tests and deployment follow-up

```powershell
npm.cmd run typecheck
npm.cmd test
npm.cmd run test:browser
```

D1 and browser tests apply migrations to isolated on-disk databases with a fixed clock. The browser suite uses Microsoft Edge by default on Windows, or the installed Playwright Chromium on other platforms. To use downloaded Chromium on Windows, run `npx.cmd playwright install chromium`, set `$env:OUAHAD_BROWSER_CHANNEL = 'chromium'`, then run the browser suite. Set `$env:OUAHAD_BROWSER_SCREENSHOTS` to retain screenshots in a folder of your choice.

The sync tests cover normal, empty, no-change, failing, overlapping and replayed runs against local D1. They invoke the real scheduled handler in workerd with controlled feed responses, and verify through public HTTP that a source proposal cannot replace an approved listing. Live manual and scheduled-handler checks are separate from the deterministic tests.

Before deployment, choose and bind the production D1 database, apply the catalog/sync migrations and an appropriate real-account schema, and explicitly activate the intended cron schedule. Connect the browser catalog to its production runtime, assign an owner for review, and connect structured failure logs to operational alerts. Reviewed source facts are currently versioned in JSON and bundled into the Worker; refreshing those facts requires rebuilding the bundle. Broaden source coverage, decide run-history retention and add a production backup/restore procedure. Replace Phase 5's local identities with production authentication and add separately consented email delivery as described in `docs/phase5.md`. No remote services, production accounts, or email have been created.
