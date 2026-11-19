# Private create form correction — 19 November 2026

Started from a clean `codex/production-launch` worktree at `da458f2`. The production Worker was serving version `12710e9c-ea97-48de-a0df-36ceb117b812` (100%). The production D1 binding points to `eee8ef16-7e86-474a-bc4f-c6a9c95c8989`, with all seven migrations applied and the expected private ownership foreign keys. No migration or production data change was needed.

## Confirmed diagnosis

A read-only, aggregate production-log query for `POST /my/new` showed one **400** and one **303** in the inspected window. It requested counts by HTTP status only, not events, request bodies, headers, account IDs or session values. Public `/` returns 200 and unsigned `/my/new` redirects to Google sign-in (303).

Using the deployed build in local workerd and local D1 with synthetic provider sessions:

- Valid unknown dates, date-only dates, and exact times in `Africa/Casablanca` save with **303** and persist.
- Reversed event dates, a whitespace-only required field, and an unsupported URL scheme reproduce **400**, “Could not save / Check the form values and try again”, with the form discarded.
- The confirmed implementation defect is the create route's handling of validation exceptions: it forwarded them to a generic error page, losing both the field error and entered values. Source migration, Google identity mapping and session/CSRF enforcement are not implicated by this reproduction.

The exact field that triggered the owner's original submission is **not yet established**. No raw original input was obtained or logged. The owner was asked only about precision, time zone, relative start/end ordering and URL category. Do not claim a particular original field was invalid without that evidence.

The private create form records stage event dates; it has no registration or submission deadline controls. Catalog deadlines were not changed. Equal date-only start/end values are valid; equal exact start/end instants are invalid. Unknown dates remain null; exact times require a named source time zone. No Morocco offset is hardcoded.

## Change

`parseExternalForm` reuses the existing stage/date/schema validation. Known validation failures now return **400 with the create form still present**, its input values, selected format, attendance checkbox and active language retained. A localized summary links to fields marked with `aria-invalid` and associated inline errors. Ambiguous clock-change errors open the relevant options. Copy is provided in English, French and Arabic RTL. Optional URL whitespace is normalized; invalid values are not silently accepted or replaced.

The handler verifies origin, session, CSRF, duplicate parameters and permitted field names before echoing editable fields. It never accepts an owner/user ID from the form. Existing ownership checks, secure provider cookies, redirect behavior and the public publication boundary are preserved. Validation logs contain only fixed field names and error classifications, never submitted values, session tokens, authorization codes or exceptions containing inputs. Error forms remain `Cache-Control: private, no-store`.

## Verification

```powershell
# Use Node 24.22.0 as pinned by .node-version.
npm.cmd run typecheck
npm.cmd test
npm.cmd run test:browser
npm.cmd run test:production
```

Passed: **42 core tests, 17 browser tests, 2 built-Worker integration tests**. New coverage includes valid creation with unknown/date-only/exact dates, invalid fields and clock-change cases, retained and escaped values, correction and save, reload persistence, another account's 404, CSRF/origin rejection, and absence from public catalog reads/direct detail routes. Browser correction/reload runs in EN/FR/AR, including mobile Arabic RTL. Provider-policy integration uses the actual `cf build` artifact, workerd and local D1 with synthetic server-validated sessions; it is not a live Google verification.

No DNS, D1 reset, source schedule, public-email flag or reminder-sending configuration changed. No live private entry was inserted through an administrative bypass.

## Owner production retest

1. Open `https://hackathons.ouahad.space/my/new` in the browser used for Google sign-in. If redirected, select **Continue with Google** and finish sign-in; the return target remains `/my/new`.
2. Use non-sensitive sample text, e.g. name “Private save check”, field “Data science”, stage “Main event”; leave the optional URL blank. Choose a future start date and a later end date, with both times blank. Click **Add privately**. Expect a redirect to `/my/entries/...`; reload and confirm the entry remains.
3. Add another sample with an end date before its start. Expect the same form with a specific end-date error and all inputs retained. Correct only the end date and submit again.
4. For exact times, use `Africa/Casablanca` and a later end time. If the source time zone is unknown, use date-only values rather than inventing an instant.
5. Check the public catalog and archive; neither sample should appear. Repeat with `?lang=fr` or `?lang=ar` if desired. Do not share session cookies or a raw Network request; only the HTTP status and displayed field-error label are needed if a failure remains.

Production verification must distinguish public HTTP checks and deployment confirmation from a completed authorized Google/private-create browser test. The latter requires an authorized browser session; it must not be claimed from the synthetic tests above.
