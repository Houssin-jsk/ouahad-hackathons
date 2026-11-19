# Transactional email presentation

Presentation-only work based on production commit `1c22a94`. No live email was sent and nothing was deployed. The existing subjects, recipients, code lifecycle, Google sign-in, consent, reminder timing, Cron, quotas, leases, retries and logical idempotency keys are unchanged. No migration or production database operation is needed. All original `public/icons` files are unchanged.

## Shared layout

`src/email/templates.ts` renders a single-column, 600px maximum-width table layout with inline CSS, semantic headings and real selectable text. It uses paper `#F7F5EF`, card `#FFFDF8`, ink `#10212B`, a green `#077F64` action, a thin blue `#3590DF` rule, and amber `#F3A339` only as a timing rule. Georgia/Times headings and Arial/Tahoma body copy need no external fonts. The existing black PNG mark is displayed at 40px next to a persistent text wordmark; images may be blocked without losing branding or content. There are no scripts, tracking pixels, web fonts, SVG dependencies or decorative background images. Outlook gets a fixed-width conditional table fallback and padded button cells; rounded corners are optional polish.

All dynamic text and attributes are escaped, including official titles, stage names, dates and URLs. Action URLs accept only HTTP(S) without embedded credentials. The renderer does not accept source HTML. All three languages share the layout; Arabic has `lang="ar"`, RTL direction and alignment, a mirrored timing rail, isolated source names, and an explicitly LTR code. Official names are not translated.

- **Delivery-address verification:** the six-digit code is the main visual focus, followed by the existing expiration/security text. No CTA or link. Email-login messages are left unchanged.
- **Accepted-stage reminder:** opportunity and stage precede the start date. Exact instants use the existing Morocco-time formatter; date-only values have no clock time and explicitly say so. An end date is separate and omitted if absent or identical. Unknown starts stay unknown. One green button opens the same private entry and stage anchor as the plain text, preserving language. A secondary text link opens reminder settings.
- **Schedule correction:** the existing flow already sends this after a previously delivered schedule changes. The message clearly says it replaces the earlier timing and labels the current schedule as updated. The current stored payload has no structured previous-date snapshot, so the template does not invent an old date, an old/new comparison, or which individual field changed. Adding that comparison would require a separate data-design change.

## Immutable queued content

New live address messages and newly queued live reminders include both `text` and optional `html`. The existing plain-text subject/body remain unchanged. Local captured reminders remain plain text.

Rendering happens before the existing encrypted enqueue operation. Dispatch sends the stored envelope, without re-rendering. Replanning the same logical ID uses the existing `INSERT OR IGNORE`, so pending/retry jobs retain their ciphertext and original provider payload, even when they predate HTML support. There is no backfill, queue reset, key-version change or migration. Existing never-attempted cancelled jobs retain their prior reactivation policy; this patch does not change queue logic.

## Local previews

Run from the repository. Use the supported Node release and its current timezone data, rather than a fixed Morocco offset:

```powershell
npx.cmd --yes --package=node@24.22.0 --call 'node scripts/preview-emails.ts --serve'
```

Open [the design gallery](http://127.0.0.1:4188). Stop with Ctrl+C. For files only, omit `--serve`. The script writes nine HTML files and nine plain-text counterparts to `.local/email-design`. It opens no database, credentials, accounts or sender. `000000` is a clearly identified synthetic preview code, not a valid challenge. The sample opportunities are synthetic, and the private buttons deliberately point to nonexistent preview entries. No sample enters the catalog or user data.

Desktop (1024px) and mobile (390px) JPEG captures for all nine variants are also saved in `.local/email-design`, named `<kind>-<lang>-desktop.jpg` and `<kind>-<lang>-mobile.jpg`. The Arabic reminder deliberately shows a date-only stage; its schedule-change variant shows exact Morocco times.

Useful review files:

- `verification-en-desktop.jpg`
- `reminder-en-desktop.jpg`
- `schedule-change-fr-desktop.jpg`
- `verification-ar-mobile.jpg`
- `reminder-ar-mobile.jpg`

These ignored local artifacts are for review and are not public Worker assets.

## Verification

```powershell
npm.cmd run typecheck
npx.cmd --yes --package=node@24.22.0 --call 'npm test'
npx.cmd --yes --package=node@24.22.0 --call 'npm run test:browser'
npx.cmd --yes --package=node@24.22.0 --call 'npm run test:production'
```

Passed: TypeScript, 47 core tests, 18 browser tests and two built-Worker tests. The new local-D1 test freezes a legacy text-only reminder, replans it, simulates a timeout, replans again and verifies identical ciphertext, complete provider bodies and idempotency keys on retry. A new HTML message is also proven immutable on repeated enqueue.

Browser checks cover all nine message/language variants at 320px, 390px and 1024px, with images deliberately blocked; the wordmark and content stay readable, codes are LTR, primary targets are at least 48px high, links preserve stage/language, and long Latin/Arabic names wrap. The unchanged full browser suite covers accounts, privacy, agenda, dates, conflicts, locales and local outboxes. All provider calls in tests are mocked.

These are browser and local workerd checks, not a claim of live Gmail/Outlook client rendering. The templates are ready for design review; deployment and any real-mail rendering test remain separate owner-authorized actions. Current production delivery continues using its existing version.
