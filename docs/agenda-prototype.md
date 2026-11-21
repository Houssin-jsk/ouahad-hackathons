# Deadline-first public agenda prototype

Historical local review. Variant A was subsequently approved; see [the final UI release guide](ui-release.md) for the implementation and verification scope.

The subsequent [typography-only review](typography-review.md) replaces the original serif content typography with two local sans-serif candidates. The descriptions and before/after images below record the first agenda pass; the current font choices and measurements are in that review.

Local, reviewable work on top of `60343cf`. No commit/push, deployment, production D1 read/write, DNS operation, live email, source run or reminder run was performed. The public catalog continues to read approved D1 revisions through the existing catalog model. Original `public/icons` files, private dashboard content, OAuth protocol, email behavior and both Cron schedules are unchanged.

## Brief and limits

The attached `Pasted text.txt` is the implementation brief. Its referenced Sol 6.2 research and two-page PDF were not included in the attachment folder or repository. This prototype follows the written hierarchy/behavior; it cannot claim a PDF comparison or reproduce unavailable wireframe example data. The preview instead freezes the repository's existing reviewed Phase 1 and launch records. No facts were edited to make the screen look open. The [reported Infer-a-thon date discrepancy](data-issues/infer-a-thon-dates.md) remains separately flagged without changing any source fixture or live record.

## Implemented

- Shared header: one visible, tinted destination group with a current section; an independent outlined, labelled language disclosure; second-row navigation on normal mobile widths; a labelled Menu with the current section when the destinations no longer fit. Event pages retain Catalog/Archive context and their filter-aware back links. The compact mobile brand lockup leaves a separate column for language.
- Catalog: search, audience choices, an always-visible Open only switch, native in-flow additional filters, accurate count, removable filter chips and clear-all. Native GET forms/links and `details` disclosures work without JavaScript. `sort=event` preserves chronological browsing; the default deadline order puts confirmed-open direct-stage cutoffs first, then confirmed-open entries without a cutoff, then unconfirmed registrations. No event/submission date stands in for a cutoff.
- Rows: an underlined title is the detail link. Location/online eligibility, explicit registration status and the application cutoff carry the hierarchy. Summaries, topics, stages, event dates and submission deadlines move to the detail template. Known cutoffs do not turn unconfirmed registrations into open ones; independently verified open registrations can still have an unknown cutoff.
- Detail: title, venue/format and organizer first. One decision panel sits alongside content on desktop and immediately below the heading/venue on mobile. It contains status, cutoff, an eligibility cue before an online Apply action, outlined Save, official evidence and verification age. Confirmed-open applications with a valid HTTP(S) registration link get one filled green Apply action. Unconfirmed registrations get Check organizer's site; closed/finished listings have no Apply. All stages and separate application/event/submission timing remain visible below.
- Save: signed-out users sign in and return to the same public event, language and filters. They can then use the existing explicit private-save confirmation. Signing in, viewing details or opening an organizer URL does not save/apply automatically. Signed-in users retain the existing save route and ownership checks.
- Visuals: paper/surface/ink palette, Instrument Serif and IBM Plex Sans; Noto Naskh Arabic and IBM Plex Sans Arabic; a thin blue agenda rule and one amber deadline star. Lucide SVG paths use currentColor and explicit sizing; only directional arrows mirror in RTL. External-link icons were checked in the rendered button. Fonts and licenses are served locally with `font-display: swap`; no runtime font CDN is required.
- Motion: star settles once in 280ms, filter content reveals in 140ms, and the existing Save confirmation card settles in 120ms. Text, actions and focus are never hidden or delayed. Reduced motion removes these animations. The dashboard itself is not redesigned.

The only CSP addition is `font-src 'self'` for these local assets, including the shared header on private pages; no scripts or external font origin were enabled. A stylesheet version query avoids mixing the old cached CSS with the new markup.

## Local preview

From the repository, use Node 24.22.0 or a supported newer version (the timezone data matters):

```powershell
npx.cmd --yes --package=node@24.22.0 --call 'node scripts/preview-agenda.ts'
```

Open [the prototype](http://127.0.0.1:4186/). The script ignores local auth/email/D1 environment files and uses only `.local/agenda-redesign/d1`. It seeds existing source fixtures through the normal importer, approves nine real examples only in this isolated local store, and keeps three other editions as drafts. The clock is **19 November 2026, 12:00 UTC** for reproducible cutoff/evidence behavior. It never invokes source sync or email jobs. My Hackathons uses the existing development-only Aya/Sami sign-in; no Google credentials are loaded or copied. Production Google is unchanged and tested locally through the existing test-provider suite.

Stop with Ctrl+C. The script does not reset databases. On repeated runs, stable IDs/reviews are preserved. Do not use `--capture-before` on the redesigned code: that option was used once, before editing, to preserve baseline HTML/CSS with the same approved records and clock.

The existing before snapshots are available in this worktree at [port 4185](http://127.0.0.1:4185/). On a fresh checkout without ignored `.local` artifacts that comparison server has no baseline files; the actual prototype on 4186 still works.

## Screenshot comparisons

Screenshots are first-viewport comparisons at 1280×1000 and 390×1000. The same event is used on both detail pages; the same approved records are used in both catalogs. The changed catalog order is intentional: Open Data's November application cutoff now precedes Infer-a-thon's December cutoff, despite the reverse order of their event starts.

| View | Before | After |
| --- | --- | --- |
| Catalog, desktop | [Before](../.local/agenda-redesign/before-catalog-desktop.jpg) | [After](../.local/agenda-redesign/after-catalog-desktop.jpg) |
| Detail, desktop | [Before](../.local/agenda-redesign/before-detail-desktop.jpg) | [After](../.local/agenda-redesign/after-detail-desktop.jpg) |
| Catalog, mobile | [Before](../.local/agenda-redesign/before-catalog-mobile.jpg) | [After](../.local/agenda-redesign/after-catalog-mobile.jpg) |
| Detail, mobile | [Before](../.local/agenda-redesign/before-detail-mobile.jpg) | [After](../.local/agenda-redesign/after-detail-mobile.jpg) |

[Arabic mobile detail](../.local/agenda-redesign/after-detail-ar-mobile.jpg) shows mixed Latin/Arabic content, the mirrored back arrow, online eligibility before Apply, and a date-only cutoff without a guessed time.

## Verification

```powershell
npm.cmd run typecheck
npx.cmd --yes --package=node@24.22.0 --call 'npm test'
npx.cmd --yes --package=node@24.22.0 --call 'node --test --test-concurrency=1 test/browser/*.test.ts'
npx.cmd --yes --package=node@24.22.0 --call 'npm run test:production'
```

Passed: typecheck, **49 core tests, 19 browser tests and two built-Worker tests**. All databases/provider responses used by these tests are local/synthetic. No live Google, email or production interaction is claimed.

The new regressions cover independent open/cutoff truth, stage-aware deadline ordering, all action states, archive context, unapproved data invisibility, exact filter/language return after sign-in, explicit save without an application, fixed-clock dates, and retained stage progression. Existing summary-approval checks now inspect the detail page because rows intentionally omit summaries.

Browser automation uses installed Microsoft Edge/Chromium on Windows, including JavaScript-disabled browsing. It checks EN/FR/AR at 1280, 320, 360 and 390 CSS pixels, in-flow filters, chips, counts, keyboard activation and solid visible focus, primary targets at least 44px high, header collision bounds, mobile panel order, SVG geometry/currentColor, direction-specific mirroring, long mixed-direction titles, 200% text with fonts blocked, and reduced motion. The full private-account, test-provider auth, conflicts and email suites continue to pass with the shared header.

One concurrent all-suites run hit the existing 8-second navigation timeout while saving a private stage. The full browser suite subsequently passed sequentially; the serial command above is the reported 19-test result. The native Open only switch was separately checked with both Space and Enter and JavaScript disabled; turning it off removes `status` while retaining the other filters.

Manual in-app Chromium checks inspect the actual rendered desktop and mobile catalog/detail, the expanded filter panel, Arabic RTL and the narrow Menu. These mobile sizes and text enlargement are emulations. No physical phone, Safari, iPhone, Android device or OS-level browser zoom was tested. Browser rendering is not proof of those platforms.

Review stops here: changes are uncommitted, unpushed and undeployed.
