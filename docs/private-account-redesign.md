# Private account: personal agenda and local email codes

This pass changes private account screens and their local sign-in options. It does not deploy, send live email, change DNS, publish listings, or change the daily sync schedule. The public agenda renderer, archive, public stylesheet and original translations are preserved. Every file in `public/icons` retains its filename and contents. Google issuer/subject mapping, credentials, OAuth scopes and callback validation are unchanged.

## Personal agenda

My Hackathons now gives the next relevant stage a prominent paper-and-blue agenda card, with a date rail, its private status, exact/date-only timing, a conflict notice when applicable and a clear next action. Submitted/accepted commitments take priority over bookmarks. Declined, organizer-rejected, unavailable and attended stages do not become the next commitment. For stages on the same day with uncertain ordering, accepted commitments take priority; no clock time is invented for sorting a date-only event. Unknown dates have an intentional “no next stage” state rather than a guessed schedule.

Opportunities are grouped through current-status filter chips. Each row displays its timing and the other opportunity involved in an overlap, so warnings are next to the affected records as well as in the warning panel. An action panel points to overlap review, an attendance decision, a result to record, missing known dates, or a saved application to check. Opening an organizer link still cannot mark an application submitted.

The progress view uses three independent milestones: editions applied to, accepted and attended. An invitation can skip an application; this is not a conversion funnel. Total competition entries, attended stages and advancements are separate. A saved edition counts once according to the existing rules; saves alone do not count. There is no donut, public progress or leaderboard. The empty state has real catalog/private-intake actions and explains how progress begins, without example events or fabricated statistics.

The private design uses the existing warm paper, dark ink, blue date rail, green action surfaces and amber warnings. Important actions are buttons; ordinary references remain links. The small inline SVG set uses the same 24-unit grid, 1.65-unit rounded strokes and consistent geometry. There is no icon library or illustration pack. Motion is limited to save confirmation and action feedback and respects reduced-motion preferences. Input and action targets are comfortable on mobile, with visible keyboard focus. English, French and Arabic use the same hierarchy; logical spacing, mirrored directional arrows and isolated source names support RTL.

## One save per stage, precise dates

Each existing stage has one save form. Application status, organizer decision, attendance plan, actual attendance and result remain distinct fields and columns. An owner-scoped atomic update saves them together; an edit-version check rejects stale forms with 409 instead of overwriting more recent progress. The older single-field endpoint remains available for compatibility, but is not exposed as five competing save buttons.

Private external schedules use native date/time controls. A blank date is unknown, a date with a blank time remains date-only, and a time requires a date and source zone. The zone field supports common IANA suggestions and any valid named source zone. Exact times are displayed in Morocco time in the agenda. Unchanged exact values retain their original timestamp/offset and precision. Nonexistent seasonal-clock times are rejected; repeated times require the organizer's first/second occurrence. Catalog schedules remain read-only and continue to follow approved revisions. Pending proposals cannot change them.

Conflict calculations retain Phase 5 behavior: relevant stage commitments, warnings before acceptance, confirmed exact overlaps versus possible date-only/window overlaps, conditional downstream stages and removal on declining. A save recalculates warnings on the next read without deleting any history.

## Continue with email — captured development delivery only

The normal Google sign-in remains available. “Continue with email” is one flow for both returning and new email identities, with no Gmail-only check or separate Yahoo/Outlook buttons. Only a successfully verified code creates an email account or signs into its existing internal ID. Matching a Google address or display name never links or claims that user's records. Linking accounts is intentionally absent.

Migration `0005_local_email_codes.sql` adds email identities, one-use challenges, request limits and a local captured outbox; it does not rewrite existing account or catalog records. Codes are cryptographically random six-digit values, valid for ten minutes, bound to the requesting D1 session and CSRF protection. A challenge permits five verification attempts. A resend invalidates the previous challenge. Requests have a 60-second cooldown and limits of five per hour per address/session. Code consumption is atomic; successful sign-in rotates the session and removes its old challenges/outbox through the existing session lifecycle. New and returning addresses use the same request path.

The challenge stores an HMAC verifier; the **local test outbox deliberately stores the captured code** so the owner can exercise the flow without sending email. Its browser route is session-owned, expires with the challenge, uses `private, no-store`, and cannot read another session's messages. Codes do not appear in URLs or application logs. This is a real code-validation protocol with simulated delivery, not proof that a mailbox received a message. Do not move captured-test email identities into production accounts.

Enablement requires all of: the Node development runtime, an HTTP loopback origin, configured Google or the explicitly local test provider, and `EMAIL_SIGNIN_MODE=capture`. The deployed Worker always resolves production mode, so this transport stays disabled even if someone sets that variable on a public build. Public email routes return 404 and the option is visibly unavailable. No SMTP, email API, billing, sender DNS or reminder delivery is configured.

The security checks follow the relevant [OWASP authentication guidance](https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html) and [short-lived code guidance](https://cheatsheetseries.owasp.org/cheatsheets/Forgot_Password_Cheat_Sheet.html); these references are not a claim of a production security audit.

## Run and inspect

The configured Google preview is at `http://127.0.0.1:4177/my`. The existing Google account's store was found at `.local/d1-sync`; its inherited path is now explicit in the ignored `.env.auth.local`, and local capture is enabled there. Client credentials were not changed. To restart it after stopping that preview:

```powershell
node --env-file=.env.auth.local src/cli.ts migrate
npm.cmd run preview:google
```

Choose Continue with email, enter an address, request the code, then use **Open test outbox** in that browser. Copy the captured code and return to the verification form. No message is sent to the address. The Google and email accounts remain separate even for the same address.

For a separate test-provider preview without Google credentials:

```powershell
$env:NODE_ENV = 'development'
$env:OUAHAD_PREVIEW_PORT = '4178'
npm.cmd run preview:auth-test
```

This uses `.local/d1-auth-test`, port 4178 for the app and localhost:4181 for the clearly labeled provider. It migrates and seeds ten drafts; it never approves them. “Test account One/Two” exercises signed test-provider tokens, and the same UI offers captured email codes. The previous demo previews remain at ports 4175/4176 through `scripts/start-private-preview.ps1`.

```powershell
npm.cmd run typecheck
npm.cmd test
$env:OUAHAD_BROWSER_SCREENSHOTS = '.local/private-account-redesign/regression'
npm.cmd run test:browser
```

## Verification and comparison artifacts

The before/after gallery is `.local/private-account-redesign/comparison.html`, with **48 matched screenshots**: sign-in, empty agenda, populated agenda and stage editor, in three languages at 1440px and 390px. These use unchanged demo opportunities; the real Google user's private content was not used for screenshot fixtures. Tests use separate temporary D1 stores and explicitly labeled private examples.

Coverage includes Google/test-provider callbacks and retained issuer/subject identity, code expiry/replay/attempt limits/resend/cooldown, session-owned outbox reads, same-address Google/email separation, returning email identity, private/public isolation, stale/cross-owner stage saves, source-zone clock changes, date-only precision and conflicts. Browser checks exercise all three languages, RTL mixed names, desktop/mobile overflow, one save per stage, useful empty states and keyboard focus. Existing catalog, owner review and scheduled-sync tests remain in the suite.

The real local Google store and both older demo stores were compared before and after migration. Hashes confirmed unchanged users, identity mappings, saved entries, stage history, editions, revisions, stages and source evidence; the Google store retained its one provider identity and one saved opportunity. The preservation report is `.local/private-account-redesign/preservation.jsonl`, containing counts/digests rather than private record contents.

Final results: TypeScript passes; all **26 automated tests** and **15 browser tests** pass. The existing public catalog, source/review boundary and scheduled Worker tests remain green. The comparison gallery is also available through a loopback-only screenshot viewer at `http://127.0.0.1:4182` while its local helper runs (`node .local/serve-comparison.mjs`).

## Before an actual sign-in code can arrive

Implement and verify a real transactional delivery adapter, select its service/terms, configure a verified sender and any required DNS only in a separately authorized task, and test actual receipt across mailbox providers. Add production-only verifier secrets and broader abuse controls, delivery errors/bounces, operational monitoring and a retention/deletion policy. Keep test-outbox access and captured identities outside that production path. Only after delivery and the end-to-end security checks are verified should a production email mode be implemented and enabled; changing this capture flag cannot enable it.

Reminder emails remain a later task with independent opt-ins, accepted-stage timing, rescheduling, corrections, cancellation and unsubscribe handling. This pass sends neither sign-in nor reminder emails.
