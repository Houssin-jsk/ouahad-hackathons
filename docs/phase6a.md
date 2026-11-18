# Phase 6A: provider-backed authentication preparation

Implemented and checked locally on November 18, 2026. No external account, OAuth client, remote D1 database, deployment, DNS change, billing activation or email was created. **A real Google login has not been verified.**

## Decision and current terms

Only two options were compared:

| Option | Setup and free starting point | Production limitations |
| --- | --- | --- |
| **Google OpenID Connect directly — chosen** | Google account, free Cloud project, consent configuration and an OAuth **Web application** client. The application keeps users and opaque sessions in the existing D1 database and uses the existing Worker. No additional hosted auth subscription, Firebase or paid Identity Platform product is used. | Entrants need a Google account. Complete OAuth branding/domain/policy requirements; Workspace administrators can restrict access. Google does not publish an unlimited MAU entitlement in these setup documents; no such guarantee is assumed. |
| Auth0 OIDC | A hosted tenant and application. Current B2C Free plan: $0/month, 25,000 monthly active users, no credit card required to sign up. | Adds a vendor tenant and plan limits. Custom-domain verification requires a card; social connections are subject to system limitations. Essentials currently starts at $35/month. It is not integrated here. |

Official sources checked: [Google sign-in setup and free project](https://codelabs.developers.google.com/codelabs/sign-in-with-google-button), [Google OIDC protocol and identity claims](https://developers.google.com/identity/openid-connect/openid-connect), [Auth0 current pricing](https://auth0.com/pricing), and [openid-client runtime support](https://github.com/panva/openid-client). `openid-client` 6.9.0 is pinned; it supports Workers and performs protocol and signed-token validation. This is a server redirect flow, not an embedded Google login or a password system.

Workers Free currently includes 100,000 requests/day and a 10 ms CPU limit per invocation. D1 Free includes 5 million rows read/day, 100,000 rows written/day and 5 GB total storage. These are quotas, not a promise that every workload fits: measure callback CPU and database usage before launch. Free-plan exhaustion can reject requests. No paid plan is enabled. See [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/) and [D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/). Recheck terms when enabling production.

## What changed

- Migration `0004_provider_auth.sql` rebuilds the private user/session/entry/progress tables in one D1 batch, retaining IDs, ownership and all progress. Existing users remain `kind=demo`; provider users have `kind=provider`. It never claims demo entries for anyone else. Catalog/review tables are unaffected.
- `provider_identities` maps the **validated issuer and subject** to a stable `usr_` internal ID, derived from their JSON-encoded tuple. Neither email nor display name identifies an account. No email is requested, stored or used for linking. Changing an email preserves identity; identical email claims do not merge subjects or issuers. Automatic account linking is not implemented.
- `/sign-in` creates a pre-authentication session. Its CSRF-protected POST starts authorization code flow with random state, nonce and PKCE S256. D1 stores a ten-minute transaction bound to that session, a separate HttpOnly browser cookie, the client/origin realm, and the safe return path. The transaction is consumed atomically before code exchange. Replay, concurrent callbacks, wrong browser bindings and expired transactions fail closed.
- `/auth/callback` verifies the code exchange, ID token signature against JWKS, issuer, audience, expiry and nonce. Only then can it map an identity and rotate the application session and CSRF token. Access, refresh and ID tokens are not persisted. Provider traffic has an eight-second timeout, response-size limit, endpoint allowlist and no followed redirects.
- Authenticated requests read the hashed opaque session from D1 on **every private read and write**. Production cookies use `__Host-ouahad_session`, `Secure`, HttpOnly, SameSite=Lax, Path=/ and an eight-hour lifetime. Lax permits the top-level cross-site provider callback; CSRF tokens and exact Origin checks protect writes. Sessions are scoped to issuer/client ID/application origin and user kind. Demo cookies cannot authenticate provider users.
- Sign-out is a CSRF-protected POST that revokes the D1 session and clears cookies. It does not sign the user out of Google or revoke Google's account consent. The next sign-in requests account selection. Signing out on a private page returns to its sign-in prompt with that page saved as the destination.
- Only same-origin relative catalog/private return paths are accepted. The original listing/filter query and English/French/Arabic choice survive sign-in; callback query parameters cannot replace the stored destination. Google controls its own account-screen language; the application always restores its stored language.
- The existing HTML renderer and private routes now share a Web Request/Response handler between Node and the existing Worker. Worker `scheduled` behavior and cron are unchanged; Worker `fetch` now handles read-only catalog pages and owner-scoped private forms. No owner review/write HTTP API was added. Assets are served through an explicit allowlist.
- Worker configuration declares D1, assets and Google secret/settings, with **`AUTH_MODE=disabled` by default**. The deployed entrypoint always resolves authentication in production mode; neither demo nor test-provider auth can be enabled by changing a Worker environment flag. The Node development preview still supports Aya/Sami only under its original explicit local gate. Selecting Google mode with missing credentials yields a 503 for private routes; it never falls back to demo identities. Anonymous public browsing remains available.

## Setup the owner must complete for a real local Google login

1. Sign in to [Google Cloud Console](https://console.cloud.google.com/) and create a project for **development authentication**. Do not enable billing or add Firebase/Identity Platform. The OAuth project/client is an external resource the owner creates; this task did not create it.
2. In **Google Auth Platform**, configure Branding, Audience and Data Access. Use External audience for a public app. Provide the app name, support/developer contact and accurate home/privacy information as required by the console. Request only `openid` and `profile`; no Gmail, Drive, email or offline-access scope is needed.
3. Create a **Web application** OAuth client. Add this exact authorized redirect URI: `http://127.0.0.1:4177/auth/callback`. This server flow does not require a JavaScript origin. Keep the client ID and client secret private to your server configuration. A different host/port needs its own exact registered URI and matching `AUTH_ORIGIN`.
4. Copy `.env.auth.example` to `.env.auth.local` and enter that client's ID and secret. The file is ignored; never paste the secret into a chat, source file or public frontend. It selects the separate `.local/d1-google-local` store and explicitly disables the Phase 5 dev-auth flag.
5. Run the commands below, use an external browser if the provider refuses an embedded browser, and perform the first actual Google sign-in. Confirm the callback returns to your original private page, then test sign-out and a second real account. All real accounts start without demo history.

[Google audience rules](https://support.google.com/cloud/answer/15549945?hl=en) generally describe Testing as limited to 100 configured users, **with an exception for basic identity-only scopes**: those scopes do not require allowlisting and do not get the usual seven-day authorization expiry. Do not treat Google's Testing setting as an application access-control boundary. Add intended test users where applicable, but rely on the loopback-only local server here. Production publishing and branding/domain requirements still need review in the console. Google recommends separate projects/clients for development and production: [production OAuth policies](https://developers.google.com/identity/protocols/oauth2/production-readiness/policy-compliance).

```powershell
# From the repository root; fill the copied file using an editor.
if (-not (Test-Path .env.auth.local)) { Copy-Item .env.auth.example .env.auth.local }
notepad .env.auth.local
node --env-file=.env.auth.local src/cli.ts migrate
node --env-file=.env.auth.local src/cli.ts seed
npm.cmd run preview:google
```

Visit `http://127.0.0.1:4177/my`. The seed remains ten drafts with zero public listings in a new store. You can create private external opportunities immediately; publishing catalog records still requires the owner CLI. Missing/wrong Google credentials show a sign-in error and do not create a provider account. This command contacts Google only after **your** configuration and explicit sign-in.

## Local verification without any provider account

```powershell
npm.cmd run typecheck
npm.cmd test
$env:OUAHAD_BROWSER_SCREENSHOTS = '.local/screenshots-phase6a'
npm.cmd run test:browser

# Optional persistent, browser-testable fake provider preview:
$env:NODE_ENV = 'development'
npm.cmd run preview:auth-test
```

Open `http://127.0.0.1:4177/my`. A clearly labeled test issuer runs at `http://localhost:4181`; choose **Test account One** or **Test account Two**. It signs real-format test JWTs with an ephemeral key and exposes discovery/JWKS/token endpoints. It validates PKCE and client credentials but **does not authenticate a real person**. It is imported only by test/development entrypoints. The store `.local/d1-auth-test` is separate from both Google and Phase 5 stores; all catalog seeds remain drafts. Do not run this and `preview:google` on port 4177 simultaneously. Stop with Ctrl+C. The ordinary Phase 5 previews and their accounts remain available through their original commands.

Automated tests use temporary local D1, a controlled signed issuer, and browser contexts. Coverage includes valid sign-in, original-page/language return, changed-email identity stability, same-email/different-subject isolation, issuer separation, invalid signature/issuer/audience/nonce/expiry, denied authorization, missing/wrong browser state, expired/replayed/parallel callbacks, session rotation/revocation/expiry, production Secure cookies, production rejection of demo/test auth, and migration of existing demo history without merging. The deployed Worker entrypoint is also bundled and run in local workerd against **mocked Google endpoints** with signed test tokens. That verifies runtime compatibility, not Google's live service or any real credentials.

The browser test uses different sites (`127.0.0.1` and `localhost`) to exercise callback cookies, Arabic RTL, account isolation, sign-out and re-entry to the original saved opportunity. The existing public agenda, three-language, conflict, review and scheduled-sync suites remain part of verification.

Final verification: TypeScript passes, all **22 automated tests** and **14 browser tests** pass. This includes the production Worker in local workerd, legacy demo history migration, and rejection of attempts to revive a revoked pre-authentication session. Screenshots are retained under `.local/screenshots-phase6a`; the standalone test-provider preview was also started successfully. No live provider-login result is included in those counts.

## Before production users

- Complete a successful **live Google login** with development credentials. This task verified protocol behavior using controlled providers and read current official documents; it did not claim a successful real-provider login.
- Create a separate production OAuth web client/project. Complete the console's branding/domain requirements for `ouahad.space`, privacy policy and applicable terms; review the [Google button requirements](https://developers.google.com/identity/branding-guidelines). The prepared button uses a separate Google mark under `public/auth`; no Ouahad icon was modified. Register only `https://hackathons.ouahad.space/auth/callback` on that production client.
- In a separately authorized deployment task, bind the real D1 database, apply migrations to the intended production data, package `public` as the Worker's static asset input for the declared ASSETS binding, supply the real `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` as a Worker secret, and explicitly set `AUTH_MODE=google` and the HTTPS `AUTH_ORIGIN`. Do not copy any local demo/test store into real accounts. No remote binding, secret or route was created here.
- Validate HTTPS cookies and callbacks on the real origin, callback log-query redaction in platform observability, rate/abuse protection, account/session revocation and deletion/export policy, backup/recovery and measured free-tier CPU/storage/request limits. App logout is immediate; provider-side revocation is not a push notification to existing eight-hour D1 sessions. Cross-account linking and provider revocation events are not implemented.
- Email remains separate: independent opt-ins for matching-opportunity digests and accepted-stage reminders, consent checks, rescheduling/cancellation/corrections, unsubscribe and delivery deduplication. No email was sent or configured.

Scope note: the existing scheduler Worker now also has a shared HTTP handler; its schedule and source/review code are unchanged. The public agenda's renderer, translations, filters and visibility rules remain the same. Provider credentials and a successful live login are deliberately outstanding, since provisioning was excluded.
