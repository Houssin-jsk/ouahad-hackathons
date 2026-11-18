# Phase 7A — Resend transactional delivery preparation

Implemented and verified locally on November 18, 2026. **No live email was sent.** No provider account, DNS record, remote binding, deployment or billing change was made. Google issuer/subject mapping, the personal agenda, the public catalog, publication rules, three languages and existing local code/reminder outboxes remain available. The configured Google preview remains at `http://127.0.0.1:4177/my`; its existing credentials and capture configuration were not changed.

## Provider contract and free starting point

The adapter uses Resend's documented HTTPS `POST /emails`, text messages and the `Idempotency-Key` header. It has no SMTP connection or provider SDK dependency. The sender must belong to `notify.ouahad.space`. It never follows redirects or logs provider bodies, codes, credentials, message bodies or recipients.

Current official terms: the Free plan lists **100 emails/day and 3,000/month**. Resend's daily free quota resets at UTC midnight; quotas and rate limits are shared at team level, including traffic from other API keys and inbound mail. Use a dedicated allocation/team for this application or account for other traffic. No paid plan or automatic overages are required or enabled here. Recheck the dashboard before first use. Sources: [pricing](https://resend.com/pricing), [usage limits](https://resend.com/docs/api-reference/rate-limit), [send API](https://resend.com/docs/api-reference/emails/send-email).

## Configuration and secrets

`cloudflare.config.ts` retains the existing typed `cf` configuration and source schedule. It adds disabled email settings and server-side `bindings.secret()` declarations. Binding types continue to come from `InferEnv`, without a separately maintained Worker environment interface. The installed cf CLI is 0.15.0; newer documentation includes commands absent from this version. No CLI upgrade or remote secret command was run. See [typed configuration](https://developers.cloudflare.com/cf/projects/cloudflare-config/) and [Worker secrets](https://developers.cloudflare.com/workers/configuration/secrets/).

| Name | Storage / purpose |
| --- | --- |
| `RESEND_API_KEY` | Server secret. Use a Sending-access key restricted to the verified sending domain. |
| `EMAIL_ENCRYPTION_KEY` | Server secret: 32 random bytes encoded as 43-character base64url. Encrypts queued payloads with AES-256-GCM, bound to the delivery ID. Keep stable while jobs are pending; key rotation needs a drain/migration procedure. |
| `EMAIL_OWNER_ADDRESSES` | Server secret containing comma-separated, exact addresses the owner controls. No wildcards. Required for smoke delivery. It does not grant public accounts access to one another. |
| `EMAIL_FROM` | Nonsecret setting, e.g. `Ouahad Hackathons <no-reply@notify.ouahad.space>`. Sender-domain verification is a separate owner action. |
| `EMAIL_DELIVERY_MODE` | `disabled` by default; `resend` prepares the live transport when secrets/sender are valid. |
| `EMAIL_SIGNIN_MODE` | Existing `capture` stays development-only. `live` is for a configured HTTPS public runtime; `smoke` is owner-only on a Node development loopback preview. Default remains disabled in Worker config. |
| `EMAIL_PUBLIC_ENABLED` | `false` by default. Public live email requires explicit `true`. |
| `EMAIL_MAILBOX_TEST_VERIFIED` | `false` by default. Owner attestation after an actual mailbox test, not a claim inferred from a successful API response. Public email also requires this to be `true`. |
| `EMAIL_SMOKE_ALLOWED` | Local CLI/owner-browser gate, default `false`. Does not enable public email. Individual CLI smoke sends also require `--send`. |
| `AUTH_ORIGIN` | Existing exact application origin. Public live authentication requires HTTPS. Owner-only smoke links may use HTTP loopback with `NODE_ENV=development`. |
| `OUAHAD_D1_PATH` | Local only. The email example selects the separate `.local/d1-email-smoke` database. |

The Google settings and secret retain their existing purpose. An invalid/missing email configuration disables email independently of Google. Before verified live delivery is enabled, the public sign-in screen keeps the email action disabled and its routes return 404. Known provider cooldown/quota or exhausted code budgets also disable starting another email sign-in while Google remains available. Already received codes can still be verified.

Store actual values in ignored local files or Worker secret bindings during a separately authorized release. Do not commit them, put them in public variables/assets, paste them into command arguments, or print them. The initialization helper writes an encryption key without displaying it and never overwrites an existing local email file.

## Codes, identities and priority

Sign-in and delivery-address verification reuse six-digit cryptographically random codes, ten-minute expiry, five attempts, a 60-second request cooldown, five requests/hour per email/session, CSRF and requesting-session binding. Address challenges also bind to the current internal user and purpose. A sign-in code cannot verify a delivery address, or vice versa. Successful consumption is atomic and single-use.

Live code plaintext exists only in memory and in the encrypted retry envelope until completion/expiry cleanup. Live challenges never enter `local_email_outbox`, and live browser routes cannot open either local code outbox. A successful live email sign-in maps through `live_email_identities`, separate from captured `email_identities`. Matching a Google or captured email never links accounts or claims private records. A consumed live address-verification code updates the same user's address proof to `mailbox-code`, resets reminders off and requires opt-in again. Captured proofs cannot enable Resend reminders.

The application's fixed conservative budgets are **80 codes/day + 2,400/month**, and **20 reminders/day + 600/month**, measured in UTC calendar buckets. Reminders cannot borrow code capacity. Sign-in and address-verification jobs share the priority code lane. The dispatcher orders codes first and defers reminders while an eligible code is pending. A D1 lease serializes provider requests and a one-second pacing interval stays below the documented provider rate limit. Each logical job reserves its lane once per calendar bucket, conservatively retaining reservations even on uncertain/failing sends; retries do not get a fresh budget or idempotency key.

These local reservations cannot reserve quota against unrelated applications sharing a Resend team. Actual provider daily/monthly exhaustion pauses the entire transport until the relevant UTC reset. There is no automatic billing upgrade.

## Durable delivery and reminder safety

Migration `0007_transactional_email.sql` adds live identity mappings, transport-tagged challenges, encrypted delivery jobs, budget reservations and provider/lease state; it extends address-proof kinds while preserving settings. It does not change catalog approvals, tracking ownership or local outboxes. Existing Google and demo stores were migrated with hashes confirming unchanged preexisting user, identity, entry, stage-progress, catalog, evidence, code, reminder-setting and local-outbox fields.

Delivery states are `queued`, `sending`, `retry_wait`, `quota_wait`, `provider_accepted`, `cancelled`, `failed`, and `unknown`. Per request: eight-second timeout, 16 KiB response limit, fixed HTTPS provider endpoint and manual redirect handling. Transient failures use persisted 5/10-second backoff and respect a longer Retry-After; there are at most **three provider attempts**. Quota responses wait for reset. Credential/sender rejection pauses availability for 15 minutes. Permanent rejection stops. Plaintext errors/response bodies are discarded.

The stable key is `ouahad/<delivery ID>` and the request body remains immutable across retries. Resend retains idempotency keys for **24 hours**; the application stops attempts 23 hours after the first attempt, or earlier at code/stage expiry. It never rotates a key to retry an uncertain send. An ambiguous timeout/crash remains potentially accepted; an exhausted/expired ambiguous job becomes `unknown` and needs owner review. A known rejection can be marked failed/cancelled. No exactly-once mailbox-delivery guarantee is made. [Idempotency contract](https://resend.com/docs/dashboard/emails/idempotency-keys), [provider errors](https://resend.com/docs/api-reference/errors).

Reminder planning retains Phase 6B timing: 24 hours before an exact instant, or 09:00 the previous source-local calendar day for a date-only stage; unknown zones use Morocco time for the reminder only. An unknown start remains unscheduled. Exact display times remain Morocco time. Registration and submission cutoffs are unrelated to reminders.

The planner uses approved catalog facts or saved private facts, replaces pending old schedules, and cancels obsolete delivery jobs even during provider cooldown. Before each network attempt, it reloads consent, mailbox proof, recipient/language, acceptance, attendance, source availability and schedule, then checks current D1 facts/revision/generation. Unapproved proposals do not alter mail. Declines, attendance, opt-out, stage removal and withdrawal stop pending delivery. Schedule changes after provider acceptance create one correction. A never-attempted cancelled message can resume with its original key when eligible again; an already-attempted cancelled message requires review. There is no network transaction spanning D1 and Resend: a change after the final check or handoff cannot recall a message already accepted by the provider.

The existing agenda surfaces show delivery status with the same visual hierarchy in English, French and Arabic. Live labels say **Accepted by email provider**, never “received” or “captured.” Private delivery metadata is owner-scoped. Local captured messages retain their distinct labels and browser outbox. Source names and mixed-direction values remain isolated.

An API acceptance ID means only that Resend accepted the request. Its later `email.delivered` event concerns the recipient's mail server, not proof of inbox placement or reading. No webhook endpoint or mailbox-receipt state is fabricated in this phase. [Event definitions](https://resend.com/docs/webhooks/event-types).

## Local verification — safe to run now

From the repository root, Node 24+:

```powershell
npm.cmd run typecheck
npm.cmd test
npm.cmd run test:browser
```

Focused mocked-provider tests:

```powershell
node --test test/email-delivery.test.ts test/email-worker.test.ts test/email-cli.test.ts
```

Results: **40 automated tests and 16 browser tests pass**, plus TypeScript. New tests cover encrypted code payloads, purpose/session binding and single use, no account merging, code-priority budget isolation, retries after timeouts with identical bodies/keys, overlap deduplication, bounded attempts, quota exhaustion and Retry-After, permanent rejection, request timeout and redirect handling, approved-only schedules, rescheduling/decline/opt-out/withdrawal before network, owner-only smoke gates, and nonprinting/nonoverwriting secret initialization. The actual Worker is bundled into local workerd with all provider calls intercepted; it exercises Arabic sign-in, live address verification, reminders, repeated dispatch, three-language status text, direct private HTTP isolation and Google fallback with a missing email secret. Browser regressions cover the preserved agenda, Google test-provider flow, local outboxes, locales/RTL, filtering, conflicts and draft privacy. None is a claim of live Resend or fresh live Google verification.

Keep the current local capture preview:

```powershell
# Stop the running preview before migration/restart. Do not overwrite .env.auth.local.
node --env-file=.env.auth.local src/cli.ts migrate
npm.cmd run preview:google
```

## Sender setup for the owner — not performed

1. Create/sign into Resend and select its Free transactional plan. Do not enable overages or upgrade billing. Review current quotas and any account approval requirements shown by Resend.
2. In Domains, add **`notify.ouahad.space`** as a sending domain and choose an appropriate offered region. Do not enable receiving/inboxes for this task.
3. In a separately authorized DNS task, copy **the exact DKIM and SPF/return-path records generated in that domain's Records tab**. Resend may show TXT/MX or CNAME records. Keep any CNAME DNS-only rather than proxied. The displayed hostnames, tokens, priorities and region values are authoritative; this repository invents none. Preserve existing root-domain website/mail records. Wait for Resend to show the sending domain verified.
4. Add/review DMARC for the sending domain with a deliberate reporting/enforcement policy, and check authentication headers on the first received message. Keep open/click tracking off for these transactional codes and private links.
5. Create a **Sending access** API key restricted to this sending domain and store it server-side. Record only addresses you control in the smoke allowlist. Sources: [domain setup](https://resend.com/docs/add-a-domain), [subdomains](https://resend.com/docs/dashboard/domains/introduction), [DMARC](https://resend.com/docs/dashboard/domains/dmarc), [API keys](https://resend.com/docs/dashboard/api-keys/introduction).

Prepare the ignored local file; sending remains off:

```powershell
node scripts/prepare-email-env.ts
notepad .env.email.local
node --env-file=.env.email.local src/cli.ts migrate
```

After sender verification, enter the API key and exact owner addresses locally and set `EMAIL_DELIVERY_MODE=resend`. Keep `EMAIL_PUBLIC_ENABLED=false`, `EMAIL_MAILBOX_TEST_VERIFIED=false` and `EMAIL_SMOKE_ALLOWED=false`. Do not print the file. Dry runs make no provider request and cannot prove DNS or delivery:

```powershell
node --env-file=.env.email.local src/email-cli.ts smoke signin --to 'YOUR_OWN_ADDRESS'
node --env-file=.env.email.local src/email-cli.ts smoke reminder --to 'YOUR_OWN_ADDRESS' --reminder 'PLAN_ID'
node --env-file=.env.email.local src/email-cli.ts inspect
```

## First live mailbox test — future authorized work only

The commands in this section **send real email** when configured. They were not run in this phase. Use only exact allowlisted addresses you control. An unlisted address, missing secret, disabled mode or missing explicit gate fails closed.

For one CLI mailbox-code smoke, first explicitly set `EMAIL_SMOKE_ALLOWED=true` in the ignored email file:

```powershell
node --env-file=.env.email.local src/email-cli.ts smoke signin --to 'YOUR_OWN_ADDRESS' --send
node --env-file=.env.email.local src/email-cli.ts inspect
```

This sends one actual single-use challenge through the normal rate-limited code path. It prints delivery metadata, **not the code or session cookie**. It is a mailbox smoke, not a browser login; that isolated session does not create an account or become your Google account. Check actual receipt, spam folder, sender and authentication headers; provider acceptance alone does not pass the test.

For a complete browser login and reminder test, use the owner-only local smoke preview **instead of** the standalone CLI code smoke if you want exactly one sign-in code and one reminder. Stop port 4177 first. The two env files reuse the existing Google client but select the separate email-smoke database; no original private records are copied. The normal Google redirect URI remains `http://127.0.0.1:4177/auth/callback`.

```powershell
$env:NODE_ENV = 'development'
$env:AUTH_ORIGIN = 'http://127.0.0.1:4177'
$env:EMAIL_SIGNIN_MODE = 'smoke'
$env:EMAIL_SMOKE_ALLOWED = 'true'
node --env-file=.env.auth.local --env-file=.env.email.local src/preview.ts --port 4177
```

At `/my`, choose Continue with email and enter an allowlisted address. Read the real code in that mailbox and verify it in the requesting browser. This creates/signs into a separate live-email identity in the **smoke store**, never merges Google/captured accounts. Its address proof is ready but reminders remain off. Add a clearly labeled **private smoke opportunity** with a stage starting in the next 24 hours, mark it accepted, leave attendance Going/Undecided, and opt in through Email settings. This opportunity never enters the public catalog. To test Google's separate address-verification path, sign in with Google instead and verify an allowlisted delivery address in settings; that adds one address-verification email.

In a second window, point the CLI to the same local origin/store. Environment variables override env-file values:

```powershell
$env:NODE_ENV = 'development'
$env:AUTH_ORIGIN = 'http://127.0.0.1:4177'
$env:EMAIL_SMOKE_ALLOWED = 'true'
node --env-file=.env.email.local src/email-cli.ts plan
node --env-file=.env.email.local src/email-cli.ts smoke reminder --to 'YOUR_OWN_ADDRESS' --reminder 'PLAN_ID'
node --env-file=.env.email.local src/email-cli.ts smoke reminder --to 'YOUR_OWN_ADDRESS' --reminder 'PLAN_ID' --send
node --env-file=.env.email.local src/email-cli.ts inspect
```

Use the plan ID printed by `plan`. The command sends at most the selected eligible, due reminder, rechecking real consent and current facts. It cannot force a reminder early, invent a stage time, bypass mailbox verification, or redirect it to the `--to` value. A repeated run must not send another message; a stage already settled may be reported as no longer due. Confirm actual mailbox receipt and correct private-stage link. Observe the code cooldown if repeating tests. Revert `EMAIL_SMOKE_ALLOWED=false` and remove the shell overrides afterwards; keep normal `.env.auth.local` and local capture unchanged. Do not promote smoke identities, proofs, jobs or records into a production database.

## Runner cadence and remaining launch work

**Proposed, not configured:** invoke the prepared `runWorkerEmailJob` every minute (`* * * * *`) through a separate trusted runner. Codes get an immediate request-time attempt and priority on later retries; reminders have approximately one-minute scheduling granularity. The bounded batch processes up to 20 due jobs with one-second provider pacing and persisted deferrals. A future runner must prevent overlapping long invocations and monitor backlog/expiry. All sends still use D1 leases and idempotency. The source-sync cron remains **`0 6 * * *` UTC**, unchanged, and never calls the email job. No public job-trigger endpoint was added.

Before public rollout: complete and authorize sender DNS/account setup, perform and record the first actual mailbox tests, configure Worker secrets in an approved release, and only then explicitly enable `live` plus both public/verified flags. Add signed delivery/bounce/complaint webhook handling, suppression and preference/unsubscribe policy, redacted alerts/backlog monitoring, retention/key rotation and backup procedures, and broader abuse/load checks for public code requests. Keep uncertain deliveries under owner review rather than blind replay. Bind the separate runner and review its timing/load behavior before unattended use. No new-opportunity digest is included.
