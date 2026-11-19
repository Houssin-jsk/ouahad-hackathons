# Production email rollout — 19 November 2026

Signed-in Google accounts can verify a delivery address and opt into accepted-stage reminders. Google identity mapping and existing private records are preserved. Verification binds a ten-minute, single-use code to the current server-validated session, internal account and `reminder-address` purpose. Matching email addresses never merge accounts. Verification resets reminders to off; users must opt in separately.

Email-code login stays disabled (`EMAIL_SIGNIN_MODE=disabled`), including its direct HTTP routes. Address verification uses its own `EMAIL_ADDRESS_MODE`, independent of login. Production never serves captured codes or the local reminder outbox. The private Email delivery page shows account-scoped delivery metadata, not message bodies or codes. English, French and Arabic retain the existing agenda and distinguish provider acceptance from mailbox receipt.

## Configuration and release gates

`cloudflare.config.ts` binds `RESEND_API_KEY`, `EMAIL_ENCRYPTION_KEY`, `EMAIL_OWNER_ADDRESSES` and `EMAIL_OWNER_USER_IDS` as server-side secrets, alongside the unchanged Google secrets. Sender: `Ouahad Hackathons <no-reply@notify.ouahad.space>`. No DNS, migration, account merge, billing or provider-account change was needed.

The first deployment used `EMAIL_ADDRESS_MODE=owner`, `EMAIL_REMINDER_MODE=owner`, `EMAIL_PUBLIC_ENABLED=false` and `EMAIL_MAILBOX_TEST_VERIFIED=false`. It restricted requests and delivery to the explicitly configured owner internal ID, Google identity and exact mailbox allowlist. These gates are enforced again before network delivery.

Only after both inbox checks below, the two modes changed to `public`, with `EMAIL_PUBLIC_ENABLED=true` and `EMAIL_MAILBOX_TEST_VERIFIED=true`. This enables delivery for Google accounts; it does not enable email login or change any account's mailbox proof. Missing secrets or invalid gates disable delivery without disabling Google sign-in. For rollback, set the address and reminder modes to `disabled` and rebuild/redeploy; retain the encryption secret and existing data.

Secrets are supplied through an ignored JSON file, never command-line values or public bindings. The initialization helper preserves an existing file; on first initialization it requires one unambiguous Google owner and refuses to generate a new encryption key over encrypted pending jobs. It does not send or deploy. With multiple Google accounts, configure the intended internal owner ID explicitly in the ignored file rather than inferring by email. Keep the encryption key stable and securely backed up.

```powershell
# Run from the repository with Node 24.22.0 or a supported newer version.
node scripts/prepare-production-email.ts eee8ef16-7e86-474a-bc4f-c6a9c95c8989
# Review/edit the ignored file locally if configuration changes; never print or commit it.
notepad .local/production-email-secrets.json
npm.cmd run typecheck
npm.cmd test
npm.cmd run test:browser
npm.cmd run test:production
npm.cmd run deploy -- --secrets-file .local/production-email-secrets.json
```

The helper reads the already configured ignored `.env.email.local` only when creating the secret file; shell email-mode variables do not override this parse. Worker mode flags come from the typed production configuration. Deploy uses JSON secrets to avoid dotenv variable expansion. Existing Google secrets are retained.

## Separate schedules and delivery policy

Catalog discovery stays at `0 6 * * *` UTC. The independent reminder/retry handler runs at `*/5 * * * *` UTC. Neither calls the other. Each reminder tick processes at most two due deliveries, prioritizing address codes. Interactive address requests also attempt delivery immediately. Source imports and editorial publication rules remain unchanged.

The existing dispatcher retains encrypted queued payloads, stable provider idempotency keys, a global pacing lease, bounded transient retries and separate budgets: 80 codes/day and 2,400/month; 20 reminders/day and 600/month. These fit the documented Resend Free allocation (100/day, 3,000/month); other applications using the same team can still consume provider quota. Quota failure defers delivery without upgrading billing. See [Phase 7A](phase7a.md) for the adapter and current official documentation links.

Reminders use the current approved catalog stage schedule or saved external stage schedule, not registration cutoffs. Exact stages are due 24 hours before their start. Date-only stages use 09:00 on the previous source-local day as the reminder time; no stage start time is invented. Exact times display in Morocco time. Unknown starts remain unscheduled.

Immediately before sending, the dispatcher rechecks Google-account eligibility, verified `mailbox-code` proof, opt-in, recipient, acceptance, attendance, decline, availability and current schedule/revision/generation. Changed pending schedules are replaced and obsolete jobs cancelled. Already handed-off messages cannot be recalled. `provider_accepted` is not proof of Gmail receipt. Sign-in jobs are excluded from this production runner.

## Actual production evidence

Both messages were generated by the production Worker with real Resend delivery, after the owner signed in through Google. No codes, cookies, credentials or raw private submissions were logged or copied into chat.

| Check | Evidence on 19 November 2026 (UTC) |
| --- | --- |
| Address code received | Gmail INBOX metadata: 20:45:49. Owner entered the code in the production form. D1 reports `verification_kind=mailbox-code`; verification initially left reminders off. |
| Accepted-stage reminder received | Gmail INBOX metadata: 20:55:52. Production Cron log reports `reminder-sync` and `provider_accepted`; D1 records one attempt and no error. |
| Repeated ticks | Gmail search still finds one fixture reminder; no duplicate delivery. |
| Cleanup | Only the clearly labelled private `Email rollout smoke test` stage was marked declined. Its reminder shows cancelled. Owner preference restored to off; verified proof retained. |

The smoke entry is private and never published. No preexisting opportunity, identity or schedule was changed. The proof screenshot is kept locally at `.local/email-rollout/production-reminder.jpg` and is intentionally not committed.

## Verification and owner inspection

TypeScript, 44 core tests, 17 browser tests and two built-production-Worker tests pass. Tests use local D1/workerd and intercepted provider responses, not live email. The rollout regression covers owner gates, a second Google account after promotion, single-use verification, no account creation/merge, default-off consent, Cron delivery, repeated ticks, account isolation, login rejection and absence of local outboxes. Existing suites cover scheduling, conflict behavior, cancellation, quota exhaustion, retries, three languages and RTL.

Read-only remote queries, without addresses, codes or payloads:

```powershell
npx.cmd cf workers deployments list --worker ouahad-hackathons
npx.cmd cf d1 query eee8ef16-7e86-474a-bc4f-c6a9c95c8989 --sql "SELECT verification_kind,reminders_enabled,count(*) AS accounts FROM email_reminder_settings GROUP BY verification_kind,reminders_enabled"
npx.cmd cf d1 query eee8ef16-7e86-474a-bc4f-c6a9c95c8989 --sql "SELECT kind,state,attempts,error_code,count(*) AS jobs FROM email_deliveries GROUP BY kind,state,attempts,error_code"
```

For a normal user: sign in with Google, open `/my/email-settings`, verify an address using the received code, then explicitly enable reminders. No owner action is needed for already enabled production delivery. Production email login, marketing/new-opportunity emails, delivery webhooks and a mailbox-receipt badge are not enabled. Continue monitoring quota, failed/unknown jobs and Cron outcomes; use the verified owner flow for future sender changes.
