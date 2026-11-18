# Phase 6B — accepted-stage email reminders, local capture

Implemented locally on November 18, 2026. The personal-agenda redesign, Google issuer/subject identity mapping, public agenda, archive, owner review boundary and source-sync cron (`0 6 * * *`) are preserved. No live email, remote resources, DNS, billing or deployment was used. This phase adds a manually callable reminder job, **not a second action in the source-sync cron**.

## Consent and delivery identity

My Hackathons has a small **Email settings** link. Reminders are off by default, including for accounts with an address. There is no new-opportunity email control. Interface language and the separately saved reminder language are independent; navigation does not silently change email preferences.

Only a verified address belonging to this internal account's delivery setting permits local opt-in. An email-code identity can initialize the address from its own `email_identities.user_id`. Google display names and matching email strings cannot do so: the existing Google scopes do not supply a verified delivery address. Google users can verify a separate delivery address while retaining their existing internal ID, session and records. This does not create an email sign-in identity, link accounts or transfer records. Verifying or replacing an address turns reminders off until the user explicitly enables them again.

Address verification reuses the existing six-digit, ten-minute, single-use local code protocol, cooldown and attempt limits. Challenges are additionally bound to the current internal account and the `reminder-address` purpose. Sign-in challenges and address challenges cannot be used interchangeably. The captured code is visible only to its requesting session. Signing in remains a separate flow.

**Local verification simulates address ownership; it does not prove mailbox receipt.** The UI labels this limitation. Verification/capture requires the existing Node development, HTTP loopback, provider-configured `EMAIL_SIGNIN_MODE=capture` gate. Production settings cannot enable this transport, even with that environment flag. Local test proofs and email identities must not be promoted into production verification records.

## Scheduling and cancellation

Migration `0006_stage_reminders.sql` adds owner-scoped settings, one current reminder plan per entry/stage, and an append-only captured reminder outbox. It adds a purpose and account binding to code challenges. It does not rewrite existing user, catalog, review or progress records.

Only explicitly accepted, available, not-attended stages qualify. Both **Going** and **Undecided** attendance plans qualify. Applications alone do not schedule reminders. Clicking an official application link still cannot mark an application or acceptance.

Timing policy:

- **Exact start:** 24 elapsed hours before the recorded instant, independent of registration and submission cutoffs. Display exact event and reminder times in Morocco time.
- **Date only:** 09:00 on the previous calendar day in the recorded source zone. If the source zone is unknown, use `Africa/Casablanca` for the reminder only and explain this fallback. The event remains date-only; 09:00 is never stored or displayed as its start time. Do not deliver a late date-only reminder on or after the event's source calendar day begins, because it might already have started.
- **No start date:** show “Waiting for stage dates”; leave the email unscheduled. An end date alone cannot supply the missing start.
- If acceptance or opt-in happens after the reminder time, the next manual run can capture it while the stage has not started. Past delivery windows are cancelled, not sent late.

Plans use the **current approved catalog stage**, or the saved schedule for a private external stage. Pending source proposals have no effect. A changed start, end or zone replaces the pending plan with a new generation and recalculated due time. If an earlier generation was already captured, queue one explicit schedule correction immediately, provided consent and attendance still qualify and the stage has not started. Replaying the same schedule, approving unchanged dates, opting in again or overlapping jobs cannot repeat an already captured generation.

Decline, organizer rejection, recorded attendance, owner withdrawal/removal of an approved stage, or opt-out prevents capture. Settings saves and agenda/detail/settings reads reconcile plans; the `plan` and `run` commands also reconcile all relevant accounts. A decline/withdrawal stops capture immediately through delivery guards even if a pending row has not yet been reconciled. Existing captures remain private history; they cannot be unsent.

The job brackets agenda reads with source snapshots so a concurrent edit cannot attach a new revision guard to old dates. Immediately before capture, it reloads schedule and consent. A final D1 transaction checks the reminder generation/version, recipient and settings version, current acceptance/intent/attendance, private facts, and approved published revision. The same transaction inserts the captured message and marks the plan captured. A uniqueness constraint on reminder/generation prevents duplicate outbox messages across repeated or overlapping runs. There is no network sender.

## Browser states and private outbox

The next-stage card and accepted-stage detail display **Reminder scheduled**, **Reminders off**, **Waiting for a verified email**, **Reminder cancelled**, or the missing-date state. Scheduled reminders include the due time in Morocco time and “Queued, not sent or captured yet.” After the job, the label changes to **Captured in the local reminder outbox** and links to that message. English, French and Arabic use the existing visual system, RTL layout and isolated published names.

`/my/notifications` and `/my/notifications/:id` show only the authenticated internal user's reminder captures, with recipient, subject, capture time and body. These messages have a separate table and UI from sign-in/address-verification codes. Every route validates the server session; writes require Origin, CSRF and explicit fields. No public job-trigger, owner-write or outbox endpoint was added.

## Run locally

If the CLI reports no accounts while the browser shows a reminder, first compare the actual persistence directories. See [read-only reminder diagnostics and the exact capture-preview commands](local-reminder-troubleshooting.md). The normal Google preview and isolated email-smoke preview use separate stores; a shell environment variable overrides the same setting in an env file.

From the repository root, Node 24+. Stop an existing preview before migration. Keep the existing ignored `.env.auth.local`; do not overwrite its Google credentials or D1 path. This workspace's Google preview uses `.local/d1-sync`.

```powershell
node --env-file=.env.auth.local src/cli.ts migrate
npm.cmd run preview:google
```

Open [My Hackathons](http://127.0.0.1:4177/my), then **Email settings**. Use the address-verification test outbox, verify its code, and explicitly enable reminders. Record acceptance on a future stage. No code or reminder is actually sent.

In another PowerShell window, using the same store/config:

```powershell
node --env-file=.env.auth.local src/reminder-cli.ts plan
node --env-file=.env.auth.local src/reminder-cli.ts inspect
node --env-file=.env.auth.local src/reminder-cli.ts run
node --env-file=.env.auth.local src/reminder-cli.ts outbox
```

`plan` reconciles without capturing. `inspect` reads persisted plans. `run` reconciles and captures only currently due reminders. `outbox` reads captured messages and includes private addresses/content; use it only in the local owner's terminal. Add `--user <internal-id>` to plan/inspect/outbox to narrow them. The job runs across accounts. Commands require `NODE_ENV=development`, `EMAIL_SIGNIN_MODE=capture` and an HTTP loopback origin; these are already in the configured local auth file.

For the isolated test provider without Google credentials:

```powershell
$env:NODE_ENV = 'development'
$env:OUAHAD_PREVIEW_PORT = '4178'
npm.cmd run preview:auth-test
```

Open [the test-provider agenda](http://127.0.0.1:4178/my); use the clearly labeled test identities or local email-code sign-in. The preview automatically migrates `.local/d1-auth-test` and seeds drafts only. In a second window:

```powershell
$env:NODE_ENV = 'development'
$env:EMAIL_SIGNIN_MODE = 'capture'
$env:OUAHAD_D1_PATH = '.local/d1-auth-test'
npm.cmd run reminders -- plan --origin http://127.0.0.1:4178
npm.cmd run reminders -- inspect
npm.cmd run reminders -- run --origin http://127.0.0.1:4178
npm.cmd run reminders -- outbox
```

For isolated fixtures, `--now 2026-12-01T08:00:00Z` can exercise a future cutoff without waiting. Do not advance the clock against records whose capture history you want to preserve unchanged. The automated tests below use disposable databases and fixed clocks instead.

## Verification and sample

```powershell
npm.cmd run typecheck
npm.cmd test
npm.cmd run test:browser

# Optional screenshots and a captured synthetic sample:
$env:OUAHAD_REMINDER_SCREENSHOTS = '.local/phase6b'
node --test test/browser/reminders.test.ts
```

Verification: TypeScript passes; **32 automated tests and 16 browser tests pass**. Six new D1 tests cover default-off consent, delivery verification without account merging, purpose/session/owner isolation, concurrent/replayed runs, replacement and corrections, date-only/source-zone timing, missing dates, decline/opt-out/attendance, expired windows, approved-only catalog schedules, withdrawal and concurrent capture guards, and production rejection of local delivery. The new browser journey covers acceptance → address verification → opt-in → reschedule → stale-job suppression → one capture → decline; it checks all three languages at 1440px/390px, one save button per stage, and owner-only notification HTTP reads/writes. Existing tests continue to cover Google protocol handling, public draft privacy, owner review, conflicts, precision, agenda locales and scheduled source sync. Provider tests use controlled signed test tokens; this phase did not perform another live Google login.

The configured Google and existing demo stores were migrated with pre/post hashes of user IDs/names, identity mappings, entries, stage progress, editions/revisions/stages and source evidence unchanged. The existing Google mapping and private entry remain in place. The real-store manual reminder command captured zero messages; sample captures use isolated synthetic test data. The public stylesheet, original public translations, source schedule and `public/icons` were not edited.

Synthetic capture example (never sent):

```text
Subject: Stage reminder: National final — Robotics Morocco

You marked this stage as accepted.
Opportunity: Robotics Morocco
Stage: National final
Stage dates: 2 Dec 2026, 09:00 · Morocco time — 2 Dec 2026, 17:00 · Morocco time
Reminder timing: 24 hours before the recorded start instant.
View your private opportunity: [the owner's private stage link]
Manage email settings: http://127.0.0.1:4177/my/email-settings
Local capture only — no email is sent.
```

## Before live delivery

Choose a real sending provider and configure/verify delivery and sender identity separately. Replace local-capture address proofs with mailbox-delivered verification; preserve issuer/subject account ownership and never migrate local captured test identities into real accounts. Implement network delivery with provider idempotency, bounded retries, bounce/suppression handling, redacted monitoring and retention. D1's local atomic capture does not itself guarantee exactly-once delivery through an external provider. Add the appropriate secure preference/unsubscribe flow and delivery policy. Arrange a reminder runner frequent enough for exact due times, independent of the unchanged daily source-sync cron. Production Google settings/policies and deployment operations still need their existing launch checks. No new-opportunity digest is implemented.
