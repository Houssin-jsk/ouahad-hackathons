# Approved UI release — 21 November 2026

Variant A is the product typography: locally hosted Plus Jakarta Sans for EN/FR headings and titles, Inter for reading and controls, and IBM Plex Sans Arabic for Arabic UI and Arabic text inside Latin-language listings. All public and authenticated screens use the same system. The Ouahad logo/wordmark, palette and six original icon assets are preserved.

The approved agenda work includes the compact shared header, deadline-first rows, native filters, explicit open-only control, filter chips and detail decision panel. Catalog and archive still query approved D1 revisions. Sign-in returns to the original opportunity; saving and applying remain explicit, distinct actions. No account, sync, email payload, quota, retry, opt-in, OAuth credential or schedule behavior changes are included. No production database migrations or data edits are required.

## Typography and icons

- H1: 44px desktop / 32px mobile, 700. Titles: 24px / 22px, 650 EN/FR and 700 Arabic. Reading: 16–17px. Controls: 15–16px. Metadata: 14–15px.
- Real font files include variable weight axes for Jakarta and Inter and static Arabic 400/500/600/700. `font-synthesis:none` prevents artificial bold. Arabic has no letter spacing and uses comfortable line heights. Codes retain their LTR precision and monospace treatment.
- Chromium CDP reports actual glyph fonts, not only CSS family names. The public typography regression tests also block font downloads in a fresh context and inspect real system fallback glyphs. Private heading measurements and glyph audits are saved per browser under `.local/ui-release`.
- Every application-authored functional icon comes from one inline Lucide renderer: explicit width/height, 24-unit viewBox, 20px painted box, rounded 1.8-unit strokes, `currentColor`, no flex shrink, visible overflow, `aria-hidden` and `focusable=false`. Labels explain every action. Only directional arrows and sign-out mirror in RTL; search, bookmark, calendar and external-link retain orientation. Private disclosures also use Lucide chevrons. Google’s official brand mark and the Ouahad logo remain brand images. Browser-native date/select affordances remain native controls.
- The audit corrected old 16–18px overrides and separate private stroke/path definitions. Rasterized element screenshots must contain painted pixels in light, dark-system and forced-colors contexts. The interface intentionally remains warm/light when the OS is dark. System high-contrast colors are respected.
- Safe-area insets augment body padding only on devices that expose them, avoiding a second inset on the shared header. Enlarged text reflows private cards, buttons and progress panels instead of overflowing. Reduced-motion alternatives and visible keyboard outlines remain active.

## Repeatable local checks

Use Node 24.22.0 (required for current Morocco timezone rules), or the pinned invocations below:

```powershell
npm.cmd run typecheck
npx.cmd --yes --package=node@24.22.0 --call 'npm test'
npx.cmd playwright install webkit
npx.cmd --yes --package=node@24.22.0 --call 'node --test --test-concurrency=1 test/browser/*.test.ts'
npx.cmd --yes --package=node@24.22.0 --call 'npm run test:production'
npx.cmd --yes --package=node@24.22.0 --call 'node scripts/preview-agenda.ts'
```

[Approved local preview](http://127.0.0.1:4186/) uses local demo identities only, no Google credentials, live emails or scheduled jobs. The presentation store and fixed 19 November clock are isolated from production. Browser tests use disposable local D1 stores and test-provider sessions, including distinct existing Google and email identities; they send no live email. Do not import any of those stores into production.

`ui-release.test.ts` checks nine screen types in EN/FR/AR at 320, 360, 375, 390, 430, 768, 1024, 1440 and 1920 CSS pixels. Chrome captures all nine screens at 390 and 1440; three additional frames cover icon states in normal, dark-system and high-contrast environments. Artifacts and actual font reports are in `.local/ui-release/chrome`, `msedge` and `webkit`. Existing regression suites exercise discovery/detail/deadline links, search/filter clearing and persistence, language switching, archive, test-provider OAuth return/sign-out, explicit saving/reload, private create/edit validation, independent application/attendance/results, conflicts, personal progress and reminder preferences.

## Results

TypeScript passes; 49 core tests, 23 browser tests, and 2 built-Worker tests pass, with zero final failures. A final repeat of the three rendering matrices and both affected journey tests also passes after the last control-size corrections. The matrices cover 729 screen/language/viewport combinations. Each engine checks 168 painted SVG instances across light/dark-system/high-contrast contexts. Installed Chrome reports 157.0.8103.79, Edge 154.0.4258.53; Playwright WebKit reports 27.2 on Windows. The prebuilt production deployment dry run passes. Early header-inset, legacy icon-size, control-size and enlarged-text overflow findings were fixed before release.

## Platform evidence and remaining manual checks

Installed Windows Chrome and Edge are actual desktop browser binaries, driven by Playwright. Playwright WebKit runs on Windows; it is additional engine coverage, **not Safari on macOS or iOS**. Narrow viewports and 200% root text are automated responsive/accessibility simulations, **not physical phone testing or real browser-chrome zoom**. No physical iPhone, Android or macOS device is available here.

Before claiming physical-platform coverage, check macOS Safari/Chrome, iPhone Safari/Chrome and Android Chrome:

1. Open Catalog and a detail page in EN/FR/AR. Confirm fonts, arrows, calendar, bookmark, external links and mixed Latin/Arabic names render; check keyboard focus where available.
2. Open/close Menu, language and filters; search, remove a chip and clear all. Return from details and confirm filters remain.
3. Sign in through Google, open My Hackathons and Email Settings. Read existing entries only on production; test create/edit and date-only/time controls on the local preview. Confirm native date picker, readable controls and comfortable targets.
4. Rotate the device and check notch/home-indicator safe areas. Test browser zoom/enlarged text, dark system appearance, OS high contrast where available and reduced motion. Check no sideways scrolling or clipped SVG strokes.
5. Do not request a verification code, change notification preferences or send an email for this UI check.

## Release boundary

Release only the tested commit on `codex/production-launch`, using the existing `cf build` output and `cf deploy --prebuilt --no-provision`, with the commit SHA as the version tag. Existing Worker secrets are retained; do not supply a secrets file. Compare deployed version bindings before/after and confirm the version has 100% traffic. Keep D1, DNS, OAuth, email settings and the discovery/reminder Cron definitions unchanged. Live verification is read-only: public pages/assets/fonts, localized navigation and authenticated pages only where an authorized shared session is available. Real Google completion and authenticated production writes must never be claimed from test-provider tests.
