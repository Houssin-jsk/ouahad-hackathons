# Phase 5: private local tracking

Phase 6A has now prepared provider-backed authentication separately from these demo accounts; see [current provider setup and production follow-up](phase6a.md). All Aya/Sami history remains owned by its demo identity. The development flow below is still supported; it never becomes a real user's account.

The public agenda still reads only owner-approved catalog revisions. New private tables in `0003_private.sql` store development identities, opaque sessions, owner-scoped saved editions and independent stage progress. Private external opportunities use those private tables only. No scheduler, importer, review operation, source fact or brand asset was changed.

## Run locally

From the repository in PowerShell with Node 24:

```powershell
npm.cmd ci
# Ten drafts, no public listings; private external intake still works.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\start-private-preview.ps1 -Mode Empty -Port 4176
# In a second terminal: separate demo D1 store with seven real records approved by the existing owner CLI.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\start-private-preview.ps1 -Mode Demo -Port 4175
```

Visit `http://127.0.0.1:4175/my`. Choose **Aya** or **Sami**. These are freely selectable test identities, not proof of identity. Use separate browser profiles or private windows for simultaneous accounts. Stop the preview with Ctrl+C. Records persist in `.local/d1-private-phase5-demo` or `.local/d1-private-phase5-empty`; these stores do not change the owner's normal database. Re-running the preview does not reset private progress or republish withdrawn records.

For an existing local D1 store, migrate it first and explicitly enable both local gates:

```powershell
$env:OUAHAD_D1_PATH = '.local/d1'
npm.cmd run catalog -- migrate
$env:NODE_ENV = 'development'
$env:OUAHAD_DEV_AUTH = '1'
npm.cmd run preview -- --port 4175
```

Without both `NODE_ENV=development` and `OUAHAD_DEV_AUTH=1`, the preview exposes no account routes, sign-in links, saves or private writes. The server itself also requires the development environment and binds only to `127.0.0.1`. This is a Node local preview, not a production authentication deployment. The sync Worker has no account routes.

## Boundaries and behavior

- `/sign-in` uses a server-issued pre-login session and CSRF token. Signing in rotates both. The cookie is an opaque random value, HttpOnly, SameSite=Strict, expires after eight hours, and is stored only as a SHA-256 hash in D1. Logout revokes it server-side. Secure cookies are a production HTTPS requirement; local HTTP deliberately cannot use them.
- All private mutations are form POSTs with a valid session, session-bound CSRF token, same-origin Origin and a loopback Host. Inputs have size limits and explicit field allowlists. Every entry and stage read/write checks the session's owner ID on the server. A different account gets the same 404 as an unknown ID. Request-supplied owner IDs cannot select an account. Private responses use `private, no-store`.
- `/my/save` confirms a published edition before saving; saves are idempotent per account and edition. Opening a detail or organizer link cannot submit an application. Application submitted, organizer decision, attendance intent, attendance and result are independent forms. Advancement does not imply acceptance to the next stage.
- `/my/new` adds an external opportunity privately with a primary domain and an initial stage. Users can add downstream stages and edit their private schedule with dates from the organizer. This does not propose any public listing or public schedule. An external link is a reference, not verified catalog evidence.
- Catalog saves read the latest **approved** schedule on every private read. Pending source changes cannot alter conflicts. Stable stage keys retain private progress across approval. Removed/withdrawn stages retain history with an unavailable notice and do not participate in active conflict checks. Users cannot change catalog facts through private forms.
- Submitted or accepted direct stages and their conditional downstream stages participate in checks immediately. A separately submitted/accepted final remains active independently of its prerequisite. Rejected, unavailable or **Won't attend** stages are excluded. Date-only intervals respect a named source zone; unknown zones use a conservative worldwide envelope. Exact timestamps retain their offset and display in Morocco time. Touching exact endpoints do not overlap. Only exact required attendance intervals give confirmed overlaps; date-only intervals and online windows without required attendance give possible overlaps. Missing start/end dates are explicitly uncheckable. Deadlines never enter this calculation. Warnings never block writes.

  The current catalog model does not record mandatory attendance for online windows, so those remain possible overlaps even with exact program endpoints. Timed in-person/hybrid stages are treated as attendance intervals. Private external schedules have an explicit required-attendance checkbox. A later catalog schema enhancement can carry organizer evidence for mandatory online sessions through owner review; this phase does not guess it from an online format.
- Progress counts each saved edition/external opportunity once after its first submitted application or accepted stage. Saves alone do not count. Edition acceptance/attendance totals, stage attendances and advancements are separate, with entries, stage attendances and advancements by primary domain. Declining attendance retains applications, acceptance and results. No public progress or leaderboard exists.
- English, French and Arabic cover all new controls, notices and statuses. Switching language retains the private entry; source names stay as entered and mixed-direction names/URLs are isolated. All forms work without JavaScript.

## Reproduce the story

These are **fictional private testing examples**, not new stages for any real catalog record.

1. As Aya, add **Regional Robotics — PRIVATE TEST**, domain Robotics. Add its **Regional qualifier**, December 1, 2026, `09:00:00+01:00` to `17:00:00+01:00`, zone `Africa/Casablanca`, in person, required attendance. Use full ISO values such as `2026-12-01T09:00:00+01:00`.
2. Add a **National final** stage for December 10, 09:00–17:00, same offset/zone, advancement from the qualifier. Submit the qualifier application.
3. Add **Second Hackathon — PRIVATE TEST**, direct stage December 10, 10:00–12:00, required attendance. Submit that application. A confirmed time overlap appears immediately, with the final labeled conditional and acceptance pending separately.
4. Mark the qualifier accepted, plan to attend, attended, and advanced. The final still awaits its own acceptance. Mark the final accepted: the same overlap remains, now without the conditional label. Mark the second hackathon **Won't attend**: the warning disappears; history remains. This point counts two entries, one accepted edition, one attended edition, one stage attendance and one advancement.
5. Add a third private entry with start/end `2026-12-10` only and submit its application. Its overlap with the final is possible; no time is invented. Switch to العربية and use the mobile view. As Sami, the list is empty; Aya's URLs return 404.

The browser integration test creates this entire story through forms in temporary local D1. It does not seed synthetic events into a shared or public catalog. No email is sent in any state.

## Verification and remaining production work

```powershell
npm.cmd run typecheck
npm.cmd test
$env:OUAHAD_BROWSER_SCREENSHOTS = '.local/screenshots-phase5'
npm.cmd run test:browser
```

Integration coverage includes two-account reads/writes, CSRF and origin rejection, session rotation/expiry/revocation, production disablement, draft save rejection, idempotent saves, private/public separation, independent progress, exact/date-only/unknown schedules, online-window uncertainty, touching endpoints, declines and approval-dependent schedule recalculation. The browser journey checks all three languages, RTL mixed names, mobile overflow, keyboard navigation and the qualifier/final story. Existing agenda and daily-sync tests remain applicable.

Verified November 17, 2026: TypeScript passes; all 18 automated tests and all 13 browser tests pass. Screenshots are in `.local/screenshots-phase5`, including before/after acceptance, declining, French, Arabic mobile, and the persistent demo overview. The current Aya demo has three clearly labeled fictional private opportunities created through browser forms; Sami remains empty. The second event is declined and the date-only opportunity produces a possible overlap with the accepted final. These demonstration entries are not part of the public catalog or the preview startup seed.

Before real accounts: choose an authentication provider and replace freely selectable development identities; migrate the two-ID constraint to real user identities; validate provider callbacks, use HTTPS Secure cookies and trusted production origins, add account/session revocation and abuse controls, recovery, privacy/export/deletion policy and operational security review. Retain all owner checks and keep this development handler out of the production runtime. Production D1/runtime binding and deployment work from earlier phases remains outstanding.

Email remains a separate phase: independent opt-ins for new matching opportunities and accepted-stage reminders, verified delivery, send-time consent/intent checks, cancellation on declining, rescheduling after approved date changes, corrections, unsubscribe handling and deduplication. No email preference UI, delivery, provider, remote provisioning or schedule change is included here. Material scope deviations: none; local auth intentionally provides test identities only.
