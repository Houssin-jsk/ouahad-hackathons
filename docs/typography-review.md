# Local typography review — 20 November 2026

Historical local review. Variant A was subsequently approved; see [the final UI release guide](ui-release.md) for the implementation and verification scope.

Recommendation: **A, Plus Jakarta Sans headings with Inter reading text and controls**. Both candidates pass the same readability checks. A has more open, rounded heading forms and gives the product a little character without the narrow, delicate editorial treatment. B is a good neutral alternative when a single EN/FR family is preferred. Arabic intentionally uses the same IBM Plex Sans Arabic system in both candidates.

Nothing was committed, pushed or deployed. No production data, account behavior, email, Cron or DNS was touched. The previous uncommitted agenda prototype is preserved.

## Working previews and screenshots

- [A — Plus Jakarta Sans + Inter](http://127.0.0.1:4186/)
- [B — Inter throughout EN/FR](http://127.0.0.1:4187/)
- [Side-by-side gallery](http://127.0.0.1:4191/) — twelve matched pairs, 24 screenshots: catalog and detail, EN/FR/AR, desktop and mobile. Click an image to view its original capture.

Restart all previews from the repository:

```powershell
npx.cmd --yes --package=node@24.22.0 --call 'node scripts/preview-agenda.ts'
```

The previews use the same isolated local D1 store and fixed clock as the agenda prototype. A and B serve identical HTML/content and the same routes, filters, actions and session validation. Only the EN/FR heading-family CSS variable differs in B. No query parameter, cookie or product control was added to select typography. The gallery is a separate local review tool with no data-write functionality.

Captures are saved in `.local/typography-review`. Original frames are named `<A|B>-<catalog|detail>-<en|fr|ar>-<desktop|mobile>.jpg`, at 1280×1000 and 390×1000 CSS-pixel viewports. `compare-desktop-en.jpg`, `compare-mobile-en.jpg`, and `compare-mobile-ar.jpg` show labelled pairs together. Arabic pairs are deliberately identical, demonstrating the shared RTL system.

## Measured type system

| Role | Desktop | Mobile | Weight |
| --- | --- | --- | --- |
| Page heading | 44px | 32px | 700 |
| Hackathon title | 24px | 22px | 650 EN/FR; 700 AR |
| Reading copy | 16–17px (intro/summary 16.5px) | Same | 400 |
| Controls | 15–16px | Same | 500–600 |
| Metadata | 14.5px (language caption 14px) | Same | 400–600 by role |
| Application cutoff | 20px | 18px | 600 |

Content headings have natural width, normal style, and zero added letter spacing. Arabic headings use a 1.5 line height, Arabic reading text 1.8, and no artificial tracking. Text remains directionally isolated by the existing `bdi` markup. The existing Ouahad logo, wordmark and its brand typography are unchanged; the serif brand lettering is not a content heading.

The existing palette, grid, columns, gaps, padding, borders, controls and motion remain in `catalog.css`. That file is byte-identical to the snapshot taken at the start of this typography task (`.local/typography-review/previous-catalog.css`). Typography is isolated in `public/typography.css`; B adds just the heading-family override in `public/typography-b.css`. Natural wrapping and text-block heights change with the new fonts. Long stage names can wrap instead of overflowing when text is enlarged. Shared navigation uses the new reading font; private dashboard content is not redesigned.

## Font files and actual rendering

The old rendered scale was Instrument Serif 400, negative heading/title tracking, and metadata as small as 10.4px. The files confirmed a static 400-weight display face, rather than a missing-bold download issue.

New locally hosted, unmodified font files:

- Plus Jakarta Sans variable: `wght` 200–800; supports the requested 650 and 700 without synthetic bold.
- Inter variable: `wght` 100–900 and `opsz` 14–32; used for reading, controls and B's headings.
- IBM Plex Sans Arabic: retained real 400/500/600 files plus an added real 700 file.

The original Google Fonts files and accompanying licenses are stored in `public/fonts`. Sources: [Plus Jakarta Sans](https://github.com/google/fonts/tree/main/ofl/plusjakartasans), [Inter](https://github.com/google/fonts/tree/main/ofl/inter), [IBM Plex Sans Arabic](https://github.com/google/fonts/tree/main/ofl/ibmplexsansarabic). There are no runtime font-CDN requests. `font-display: swap` and system fallbacks keep the pages readable when downloads are blocked. `font-synthesis: none` avoids fabricated weights or styles.

Verification goes beyond computed CSS: Chromium's `CSS.getPlatformFontsForNode` reports the actual fonts used for heading, event-title and body glyphs. All twelve A/B/language/width combinations use the intended custom faces, with no unexpected fallback. See `.local/typography-review/rendered-font-audit.json`; the font-file weight/axis audit is `.local/typography-review/font-files.json`. With custom files blocked, the sampled heading glyphs render in real system Arial Bold (EN) and Tahoma Bold (AR), recorded in `.local/typography-review/fallback-font-audit.json`.

## Checks

```powershell
npm.cmd run typecheck
npx.cmd --yes --package=node@24.22.0 --call 'npm test'
npx.cmd --yes --package=node@24.22.0 --call 'node --test --test-concurrency=1 test/browser/*.test.ts'
npx.cmd --yes --package=node@24.22.0 --call 'npm run test:production'
```

Passed: typecheck, **49 core tests, 20 browser tests and two built-Worker tests**. The new font test checks actual rendered faces, type sizes/weights, identical A/B public HTML, brand-font preservation, proper RTL, and a fresh browser context with custom fonts genuinely blocked. The agenda tests retain 320/360/390px, header collision, long mixed-direction names, 200% text with blocked fonts, keyboard/focus, reduced motion, private save and filter/language persistence checks. Existing account/auth/email behavior tests still pass.

Manual in-app Chromium review covers both candidates' catalog/detail pages in all three languages at desktop/mobile sizes. This is Windows Edge/Chromium and viewport/text-size emulation; no physical phone or Safari test is claimed. Comparisons and recommendations are visual judgments, not new user-research findings.

Stop at review. Choosing A or B does not itself trigger a commit, push or deployment.
