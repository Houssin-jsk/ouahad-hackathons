# Production launch — 19 November 2026

The Worker `ouahad-hackathons` is deployed to Cloudflare, with its own production D1 database and a custom-domain attachment for `hackathons.ouahad.space`. Public reachability is **pending the DNS move**: the Cloudflare zone is pending and the authoritative nameservers still belong to Namecheap. No nameservers were changed. `workers.dev` and preview URLs are disabled. There is no hosted staging environment.

The main portfolio's existing DNS targets were preserved in the inactive zone with proxy off. The existing main site remains on its original host; the hackathons application uses Workers only. The zone is on the Free plan. No billing upgrade or email send was performed.

## Build and verification

Use **Node 24.22.0** (`.node-version`), or a supported newer version listed in `package.json`. The machine's older Node 24.15.0 has IANA tzdata 2026a; Node 24.22.0 has 2026c. Morocco's legal-time update is described by the [government](https://www.cg.gov.ma/en/node/13036) and the [IANA maintainer](https://lists.iana.org/hyperkitty/list/tz%40iana.org/message/7NCXIR252EF7HEZMD7ZGWBEER4RNPZDI/). Five core tests and two browser checks assumed the older Morocco offset. Their assertions now test civil-day boundaries, round trips and Morocco-formatted instants using the named zone. Scheduling code still uses `Intl` and `Africa/Casablanca`; no fixed Morocco offset was introduced.

The supported build is `cf build`, delegated to the pinned Wrangler backend. `cloudflare.config.ts` owns Worker/resource configuration; `wrangler.config.ts` supplies `assetsDirectory: './public'`. Both tools now use Build Output v1. The compiled Worker and all public files are in `.cloudflare/output/v1/workers/default/`. [Cloudflare documents this build path](https://developers.cloudflare.com/cf/projects/).

The existing Miniflare 4 local persistence stays intact. Artifact verification uses the matching Miniflare 5 backend under an npm alias and a **separate** store. Its assets configuration uses the current API, including `runWorkerFirst`; the legacy options converter did not preserve that assets routing behavior. No local database was copied or reset.

```powershell
node --version # 24.22.0
npm.cmd ci
npm.cmd run typecheck
npm.cmd test
npm.cmd run test:browser
npm.cmd run test:production
npm.cmd run deploy:check
```

Results: **42 core tests, 16 browser tests, and 1 real-build workerd integration test passed**. The artifact test covers actual CSS/icon bytes, empty results, draft HTTP invisibility, approved reads, official links and AR/FR/EN. The core/browser suites retain provider callback security, account isolation, independent stage progress, conflicts, reminders and mocked Resend checks. `public/icons` filenames and bytes match Git. No live email was part of verification.

Additional browser checks against the built launch preview covered two active rows, one archived row, Arabic mixed-direction details, and desktop/mobile layouts in all languages. Screenshots are local in `.local/launch-screenshots/`.

## Local preview of the production artifact

This isolated store has no local demo accounts. Stop the preview before running owner commands against its store. `--built` selects the artifact runtime; it cannot be combined with `--remote`.

```powershell
npm.cmd run build
$env:OUAHAD_D1_PATH = '.local/d1-launch-worker'
node src/cli.ts migrate --built
node src/cli.ts import data/launch-catalog.json --built
node src/cli.ts review list --built
# Inspect each revision before approving. Only the three launch entries belong in this preview.
$id = 'add-open-data:hackathon-open-data-2026'
$edition = node src/cli.ts review inspect $id --built | ConvertFrom-Json
$edition.pending
node src/cli.ts publish $id $edition.pendingId --built
# Repeat inspect/publish for geek-room:infer-a-thon-2026 and hcp-tta:datathon-data-territoires-2026.
npm.cmd run preview:built -- 4180
```

Open `http://127.0.0.1:4180/`, `/?lang=fr`, `/?lang=ar`, and `/archive`. A fresh migrated store with no approvals is an empty catalog. The normal previews and the existing Google/owner-email store continue using their original local runtime and paths.

## Reviewed launch catalog

`data/launch-catalog.json` is a complete manual import, not frontend data. Only its three IDs were explicitly approved in production. The four editions materialized by the live discovery run remain drafts. Production D1 currently has **3 published, 4 drafts**, and **0 users, sessions, private entries, reminder settings or email deliveries**. No Phase 1 seed or local private store was transferred.

| Edition | Official evidence and publication decision |
| --- | --- |
| Hackathon Open Data 2026 | [ADD announcement](https://data.gov.ma/fr/actualites/lancement-de-la-3eme-edition-du-hackathon-open-data-21-22-decembre-2026-rabat), [rules](https://data.gov.ma/sites/default/files/hackathon/reglement-hackathon-open-data-2026.pdf), [application](https://data.gov.ma/fr/candidature-hackathon). Rabat, 21–22 December. Adult eligibility has conditions in Article 2. Apply before 16:30 local on 20 November; conversion uses current IANA data. The official site sometimes denies automated page requests; the official indexed announcement and PDF were checked manually. Stable Phase 1 ID retained. |
| Infer-a-thon with Superlinked | [Organizer](https://www.geekroom.co.in/event/infer-a-thon), [official Luma registration and rules](https://luma.com/f7ef30j2). Explicitly welcomes participants from anywhere with no location restriction. Registration open through 5 December; cutoff time and zone are unpublished. Building phase 5–11 December and final 20 December are documented; the final requires advancement. No project submission time was invented from the end of the building phase. |
| Datathon Data-Territoires 2026 | [HCP organizer announcement](https://www.hcp.ma/region-tanger/Datathon-Data-Territoires-2026_a804.html). Institutional student restrictions are retained. **Applications closed 30 October**; project delivery 4 December. Published in the archive, never as open. Overall published calendar retained; no speculative relationships or stages added. Venue/format left unknown. |

AR/FR/EN summaries are manual editorial text, with evidence URL and `method` per translation. Official titles and factual fields stay intact. Summary edits travel in the same immutable proposed/approved revision as dates and eligibility; a translated draft cannot replace an approved public summary. The launch test demonstrates this. No free translation provider was configured, so **automatic summary generation remains an explicit dependency**. An eventual generator can submit `method: 'generated-draft'` via the same intake and owner review; it must not publish.

Imports quarantine an exact same-title/same-official-URL duplicate from another source in the evidence queue. The owner sees possible matches by official URL or exact normalized title. Title similarity is a review hint, never proof of a shared edition or stage. Existing source-scoped IDs remain stable.

## Discovery and owner operations

The configurable registry is `data/discovery-sources.json`, bundled with the Worker. All six enabled sources were fetched successfully with the real parsers on 19 November:

| Source | What is automated | Limits |
| --- | --- | --- |
| [UCA Cité de l’Innovation RSS](https://cim.uca.ma/feed/) | Announcement title, stable GUID, link | Dates, status and eligibility require review. |
| [Hack Club documented API](https://hackclub.com/api/v1/events) | Explicitly online hackathon/jam identities, titles, links and program dates | Online alone does not prove Morocco eligibility or application deadlines. |
| [GitHub Gaming RSS](https://github.blog/open-source/gaming/feed/) | Game Off announcement candidates, skipping winners/results | Match to the manually known edition; do not create duplicates. |
| [FST Fès RSS](https://fst-usmba.ac.ma/feed/) | Official university announcements | No matching item in the current feed window is a successful run, not a failure. |
| [HCP RSS](https://www.hcp.ma/xml/syndication.rss) | Official central HCP news | Regional announcements such as the launch datathon may be absent. |
| [Technopark Maroc RSS](https://www.technopark.ma/feed/) | Official organizer/incubator news | Not complete coverage of Moroccan competitions. |

Title discovery recognizes hackathon/datathon terms in Arabic, French and English. This does not translate source text or infer facts. University/club social posts, organizer pages without a working permitted feed, and articles outside rolling feed windows remain manual intake. No Devpost scraping or undocumented API was introduced. Tested but unsuitable feeds (EMI 404, ENSA/ENSAF blocked, ENSIAS unavailable) were not enabled.

The schedule remains **`0 6 * * *` (06:00 UTC daily)**, independent of ChatGPT and of reminder delivery. Cloudflare deployment output confirms the trigger was registered. The actual handler passed local workerd/D1 tests; a live owner-triggered run against production D1 succeeded for all six sources. **A production Cron invocation has not yet been observed**: verify its first scheduled run and CPU/quota telemetry before claiming unattended production operation. Workers Free has a [10 ms CPU budget](https://developers.cloudflare.com/workers/platform/limits/); no paid upgrade was made. If the first tick exceeds the budget, split source execution into bounded Worker invocations before calling it reliable.

Bounded retries, independent source failures, fenced leases, stable scheduled run IDs, review proposals and read-time cutoffs are reused. Source fetches never refresh an organizer review timestamp or publish/withdraw a record. `sync-status` reports failures, stale sources, missing IDs and disagreements separately from healthy zero-result runs.

```powershell
$prod = 'eee8ef16-7e86-474a-bc4f-c6a9c95c8989'
npx.cmd cf auth whoami
# Explicit --remote ignores OUAHAD_D1_PATH. It does not read any local private store.
node src/cli.ts migrate --remote $prod
node src/cli.ts sync --remote $prod
node src/cli.ts sync-status --remote $prod
node src/cli.ts review candidates --remote $prod
node src/cli.ts review list --remote $prod
node src/cli.ts import data/launch-catalog.json --remote $prod
$id = 'add-open-data:hackathon-open-data-2026'
$edition = node src/cli.ts review inspect $id --remote $prod | ConvertFrom-Json
$edition.pending # Inspect first. Already-approved identical imports have no new pending revision.
# Only if a reviewed pending revision exists:
node src/cli.ts publish $id $edition.pendingId --remote $prod
# Alternative owner decisions:
# node src/cli.ts reject $id $edition.pendingId 'Evidence insufficient' --remote $prod
# node src/cli.ts withdraw $id 'Incorrect listing' --remote $prod
node src/cli.ts list open --remote $prod
```

There is no owner/public HTTP write endpoint. Remote access uses the existing `cf` OAuth profile through the CLI, parameterized SQL and atomic D1 batches. It never logs credentials. `seed --remote` is explicitly refused.

## DNS, Google and the remaining cutover

Cloudflare account: `d3403626f6382d917bac34c5281ce279`. Zone: `31272e9ee1c234ccb1b77490378cddf2`. D1: `eee8ef16-7e86-474a-bc4f-c6a9c95c8989`. These identifiers are not secrets.

1. Compare **every** record in Namecheap → Domain List → `ouahad.space` → Advanced DNS with Cloudflare → `ouahad.space` → DNS. Eleven existing public records were copied, with proxy off: root A/MX/SPF, `www`, autoconfig/autodiscover/SRV, DMARC, `send.notify` CNAME and `resend._domainkey.notify` TXT. The hackathons custom domain is an additional managed record. A scan is incomplete evidence: add any other original record unchanged, particularly DKIM and service-verification TXT. Keep unrelated hosts and existing mail delivery intact. Local comparison files are under `.local/launch-dns/`.
2. Check whether Namecheap DNSSEC is enabled; if it is, handle its existing DS/delegation before the move. Do not activate a mismatched signed delegation. Do not modify unrelated records or enable new mail routing.
3. After the complete comparison, the owner changes **only the nameservers** at Namecheap to `eva.ns.cloudflare.com` and `razvan.ns.cloudflare.com`. Wait for the Cloudflare zone to become active and the custom-domain certificate to be ready. No paid partial-zone setup is needed.
4. In the existing Google OAuth web client, add `https://hackathons.ouahad.space/auth/callback` as an authorized redirect URI, and the production origin if required by that client's setup. Check the OAuth consent app's testing/production status and allowed users. The existing client ID/secret were uploaded directly as Worker secrets from the ignored local file; no credential appears in Git. A real production callback remains unverified until the hostname works and the owner completes sign-in.
5. Verify production `/`, `/archive`, details, CSS/icons, AR/FR/EN/RTL, registration links, public email absence, Google sign-in/out, draft 404s, and a real scheduled source run. Current deployment evidence confirms upload/domain attachment/Cron registration, **not public HTTPS reachability, mailbox delivery, or a completed production Google login**.

For future releases, after configuration and migrations are ready:

```powershell
npm.cmd ci
npm.cmd run typecheck
npm.cmd test
npm.cmd run test:browser
npm.cmd run test:production
node src/cli.ts migrate --remote eee8ef16-7e86-474a-bc4f-c6a9c95c8989
npm.cmd run deploy
```

The production Worker already has its Google secrets; subsequent deploys preserve them. For a first deploy in another account, prepare a **JSON** secrets file outside Git and use `npx.cmd cf deploy --prebuilt --no-provision --secrets-file <ignored-file>`. Do not pass the entire development env file: it contains local modes and persistence paths. JSON avoids dotenv `$VAR` expansion. Check `cf auth whoami` and shell `CLOUDFLARE_ACCOUNT_ID`/`CLOUDFLARE_API_TOKEN` overrides before changing accounts. Never paste secrets in chat.

## Email is a separate rollout

Google sign-in is configured; public email sign-in, address-code delivery and reminder sending are disabled (`EMAIL_SIGNIN_MODE=disabled`, `EMAIL_DELIVERY_MODE=disabled`, `EMAIL_PUBLIC_ENABLED=false`). The production launch has no Resend/encryption/owner-address secrets. The existing local owner smoke flow, outboxes and mailbox-verification flag were left intact. The source Cron handler never invokes the prepared email job. Branded HTML email was not added in this catalog launch. Live email rollout still needs its own explicit configuration, secrets, budget checks and mailbox tests.
