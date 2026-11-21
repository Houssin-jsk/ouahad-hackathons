# Mobile catalog UX refinement — approved release

The owner approved this mobile refinement of the Variant A interface. The pre-release production baseline was `1afa826b53fec3028e523e2ac46063c0f7375c90`. Release checks rerun typecheck, core/browser tests and built-Worker tests before committing, pushing to `codex/production-launch` and deploying that exact commit through the existing prebuilt Cloudflare Worker path. The release tag identifies the commit; production bindings and schedules are compared before/after, and live checks remain read-only.

## Review

- Working catalog: http://127.0.0.1:4186/
- Matched before/after gallery: http://127.0.0.1:4192/
- Original PNGs and baseline measurements: `.local/mobile-ux/`

The comparison uses the same five real announcements, the same local D1 presentation store and the same fixed 19 November 2026 clock. Titles, dates, unknown eligibility, unverified registration, and unconfirmed cutoffs are retained. These historical examples are for visual comparison, not a statement that all five are open today. Captures cover EN/FR/AR at 320, 360, 375, 390 and 430px, plus desktop controls at 1440px. The old baseline is preserved; do not run the old agenda `--capture-before` option to recreate it.

## What changed

1. **Search and view selection.** The search action retains its visible text and loses its redundant arrow on mobile, freeing input space. The three location views have at least 44px-wide, 48px-high targets and intentional gaps. The French international label uses the concise equivalent “International en ligne” on mobile, which is also its accessible name. Filter controls share 48px targets and the open-only label fits next to Filters at 320px. The existing in-flow filter panel and removable filter chips remain.
2. **Sorting without a second confirmation.** The mobile toolbar has a quiet results line and two direct sort buttons: Deadline / Event date (localized). A tap, Enter or Space submits the existing GET route with the chosen `sort` value. The current choice is underlined and exposes `aria-pressed`; a fieldset/legend supplies context, and accessible labels specify the full application-deadline meaning. Every current filter and language is preserved. This works without JavaScript, avoids change-triggered select navigation for assistive technology, and removes the mobile Update order action. Desktop retains its existing select and explicit Update order button.
3. **Title-first listings.** Reading order is title, location/format and geographic cue, registration status, application cutoff. The category cue moves into the quiet location group instead of preceding the title. All facts remain visible. Status uses a lighter weight at the existing readable size; the title and cutoff retain priority. The blue timeline and its markers remain, with markers aligned to titles. No extra cards, shadows or backgrounds were introduced.
4. **Rhythm and reflow.** Small 4/8px relationships, 16px groups and 24/28px listing boundaries establish a predictable rhythm. Approved fonts, sizes and colors remain. The heading can wrap at 200% in narrow WebKit layouts, and enlarged view labels can wrap as complete words. No clipping or text truncation is used to conceal facts.

The only desktop compatibility change is the internal listing flow needed to retain the old visual order after the semantic source-order improvement. Matched 1440px before/after PNGs in all three languages have identical dimensions and zero changed pixels.

## Verification

```powershell
npm.cmd run typecheck
npx.cmd --yes --package=node@24.22.0 --call 'npm test'
npx.cmd --yes --package=node@24.22.0 --call 'node --test --test-concurrency=1 test/browser/*.test.ts'
npx.cmd --yes --package=node@24.22.0 --call 'npm run test:production'
```

For the previews, use two terminals:

```powershell
npx.cmd --yes --package=node@24.22.0 --call 'node scripts/preview-agenda.ts'
```

```powershell
npx.cmd --yes --package=node@24.22.0 --call 'node scripts/mobile-review.ts'
```

The gallery serves only the local review PNGs and HTML; it has no database or write routes. The normal preview helper uses local demo sign-in only, no credentials, email sending or scheduled jobs.

**Results:** TypeScript passes; 49 core tests, 25 browser tests and 2 built-Worker tests pass with zero final failures. The focused Chrome/WebKit mobile suite also passes after the final accessible-name correction. Desktop comparisons have zero changed pixels in all three languages.

`mobile-catalog.test.ts` tests Chrome and Windows Playwright WebKit with mobile/touch emulation at all five widths and all three languages, JavaScript disabled. It checks source and visual reading order, readable sizes, 44px targets, one-row normal-size navigation, SVG orientation/dimensions, visible focus, 200% text, expanded filters, long mixed-direction titles, unknown facts, native sorting via keyboard, filter preservation, back navigation, locale switching, search, chip removal, clear-all and the archive. Existing tests retain private-account, publication-boundary and deadline coverage.

**Device limitations:** installed Windows browsers and Windows WebKit are automated browser/engine checks. Narrow viewports, touch and 3× scale are simulations, not a real iPhone, Safari on Apple hardware or Android. Native VoiceOver/TalkBack, Safari browser chrome, the software keyboard, notch insets and real system text/zoom settings still need device checks. On an iPhone, review all three languages at normal/enlarged text, open search and filters with the keyboard visible, activate both sort actions, return from details, and confirm the timeline and SVG strokes remain intact in portrait and landscape. No production sign-in or email action is needed for that public-catalog check.

Backend, schema, authentication, email, Cron, discovery, event data and verification rules are unchanged. No Discovery Agent work is included.
