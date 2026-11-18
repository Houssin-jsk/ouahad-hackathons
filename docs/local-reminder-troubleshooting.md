# Diagnosing a reminder visible in the preview but absent from a CLI

All three entrypoints call `openLocalD1` in `src/local-d1.ts`. It always binds `DB` to the same Miniflare database ID, `ouahad-catalog-local`. That ID identifies a database **inside the selected persistence directory**; it does not make different directories share records.

| Entrypoint | Persistence selection |
| --- | --- |
| `src/preview.ts` | `OUAHAD_D1_PATH`, otherwise `.local/d1` |
| `src/reminder-cli.ts` | `OUAHAD_D1_PATH`, otherwise `.local/d1` |
| `src/email-cli.ts` | `OUAHAD_D1_PATH`, otherwise `.local/d1-email-smoke` |

Relative paths resolve from the process working directory. An absolute path removes working-directory ambiguity but still has to select the preview's actual store. Environment files are loaded by Node's `--env-file`, not by these source modules. Existing shell environment variables override values in an env file, and changing a shell variable does not reconfigure an already running preview.

In this workspace, the normal port-4177 command loads `.env.auth.local`, whose store is `.local/d1-sync` and whose email mode is `capture`. The email-smoke configuration selects the deliberately separate `.local/d1-email-smoke`. Verify the running preview configuration rather than assuming the smoke filename applies to it. Do not copy/reset stores to reconcile them.

## What the reports mean

`reminder-cli.ts plan` and `inspect` count `accounts` using `SELECT id FROM private_users` (narrowed only if `--user` is supplied). It is **not** a count of accepted stages, verified addresses, due reminders or eligible recipients. Without a user filter, zero accounts means the selected database contains zero stored private users.

`reminder-cli.ts inspect` reads existing reminder plans without reconciling, capturing or sending. Use it for a read-only comparison. `plan` is a write operation: it reconciles reminder settings and plans. The local reminder CLI is specifically for captured development delivery.

`email-cli.ts plan` is also a write operation. It reconciles Resend eligibility and may enqueue due messages, but does not send them. Its output lists all stored stage reminder plans, including waiting or cancelled plans; `[]` does not merely mean “nothing is due.” Use `email-cli.ts inspect` to read existing delivery metadata without planning or sending.

## Capture and Resend have different address proofs

The local capture planner accepts `verification_kind='captured-local'`. The Resend planner requires `verification_kind='mailbox-code'`. Both also require explicit opt-in, acceptance, an available stage, no recorded attendance, and an attendance plan other than Declined. Unknown start dates wait; expired delivery windows cancel.

An owner allowlist can further limit smoke delivery. It does not upgrade a captured proof. A public mailbox-test configuration flag also cannot turn a local test-code proof into mailbox verification. Do not change that flag to repair a path mismatch.

Private external opportunities are supported: `privateEntries` reads their saved stage facts from `private_stage_progress`; reminder source guards use a left join to catalog editions. Delivery authorization explicitly permits `catalog_id IS NULL`. A private stage needs no public edition or owner publication approval.

## Exact read-only sequence for the normal capture preview

This selects the existing normal preview store, regardless of a stale shell value pointing at the smoke store. It does not send, capture, plan, migrate or modify the mailbox-test flag:

```powershell
Set-Location 'C:\Users\ouaha\OneDrive\Desktop\ouahad-hackathons'
$env:OUAHAD_D1_PATH = (Resolve-Path -LiteralPath '.local\d1-sync').Path
$env:NODE_ENV = 'development'
$env:EMAIL_SIGNIN_MODE = 'capture'
$env:AUTH_ORIGIN = 'http://127.0.0.1:4177'
node src/reminder-cli.ts inspect
```

The November 18 investigation verified that relative and absolute paths to this store return the same account and reminder IDs, with unchanged application-data hashes. The separate smoke store contained no users, private entries, stage progress, settings or plans. Read-only SQLite connections were used to locate the records; CLI verification used `inspect` only. No database reset/copy, address-proof change, mailbox-test flag change or email delivery was performed. No path-resolution or private-stage planner defect was found.
