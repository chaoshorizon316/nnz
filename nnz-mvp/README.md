# 念念在 MVP Core

This package implements the current MVP core for user-scoped Soul data, Covenant lifecycle, Memory layering, Soul Ops maturity review, LLM chat, extraction, SQLite/Postgres demo persistence, basic email/password JWT auth, a homepage H5 private-chat verification flow, and a protected Soul Ops admin prototype.

Public demo:

```text
https://nnz-kego.onrender.com
```

The demo may sleep on the free Render tier. The first request after inactivity can take 30-60 seconds.

## Soul Scope Rule

Soul is always scoped by `userId + personaId`.

There is no global `DeceasedSoul`, no cross-user merge, and no automatic family sharing. Two users can both create a persona named `爸爸`, but they receive separate Soul versions, memories, snapshots, nodes, and conversations.

Every Soul, Memory, Snapshot, Node, and Conversation access path must provide both `userId` and `personaId`. Access with only `personaId` is rejected.

`ScopedSoulRepository` is the current bridge toward scoped persistence repositories. It binds a complete `{ userId, personaId }` once through `bindSoulRepository(store, scope)` and then exposes only scope-private Soul, Memory, Snapshot, Proposal, Node, Conversation, Covenant, Runtime, and Maturity operations. This keeps the MVP store behavior unchanged while giving the next Postgres repository split a safer call shape.

`PostgresScopedSoulRepository` is the table-based Postgres slice. It covers `nnz_users`, `nnz_personas`, `nnz_memory_items`, `nnz_conversation_messages`, `nnz_soul_versions`, `nnz_soul_snapshots`, `nnz_node_events`, `nnz_runtime_sessions`, `nnz_soul_update_proposals`, `nnz_credentials`, and `nnz_ops_audit_events`, with every Soul, Memory, Node, Session, Proposal, and Conversation query bound by both `userId` and `personaId`. The default demo runtime remains the snapshot path, while guarded scoped runtime mode can route `/api/me/*` through these scoped tables when explicitly enabled.

## Covenant Lifecycle

The current demo supports this user-scoped runtime flow:

```text
ACTIVE -> SEALED -> NODE -> SEALED -> GRADUATED
```

Important details:

- Only one `ACTIVE` `SoulVersion` is kept per `userId + personaId`; creating a new active version archives the previous active one.
- `sealSoul(scope)` creates a `SoulSnapshot` and moves that user's runtime session to `SEALED`.
- `activateNode(scope, nodeName)` only works from `SEALED`, reuses an existing active node with the same name when possible, and avoids duplicate node activation memory.
- `completeNode(scope)` moves the session back to `SEALED` and completes the active node.
- `graduateSoul(scope)` moves only that user's session to `GRADUATED`.
- These state changes never affect another user's Soul.

## Memory Vault Layering

Memory is now split by usage path instead of relying on a single `enabledForSoul` flag.

Important fields:

- `source`: `USER_INPUT`, `UPLOAD`, `CONVERSATION`, `CORRECTION`, `NODE`, or `SYSTEM`
- `sensitivity`: `LOW`, `MEDIUM`, `HIGH`, or `RESTRICTED`
- `enabledForRuntime`: whether memory can enter runtime reply context
- `enabledForSoulUpdate`: whether memory can be used as Soul update evidence
- `evidenceIds`, `createdBy`, and `state`

Store helpers:

- `listRuntimeMemory(scope)` excludes disabled/restricted/risk memories.
- `listSoulUpdateMemory(scope)` excludes node memories, risk memories, disabled memories, and restricted memories.
- `createSoulUpdateProposal(...)` rejects evidence ids that are not allowed for Soul update in the same `userId + personaId` scope.

## Soul Update Review

Soul updates are now reviewable proposals instead of invisible automatic changes.

Store helpers:

- `listSoulUpdateProposals(scope, status?)`
- `listSoulUpdateProposalEvidence(scope, proposalId)`
- `acceptSoulUpdateProposal(scope, proposalId)`
- `rejectSoulUpdateProposal(scope, proposalId)`

Only whitelisted `fieldPath` values can be proposed:

- `affectModel.humorLevel`
- `languageModel.petPhrases`
- `identityCore.relationship`

The demo shows user A's proposal diff (`oldValue -> newValue`) and evidence. Accepting or rejecting only works on a `PENDING` proposal. Accepted/rejected proposals are terminal: accepting a rejected proposal is a no-op in the demo, and rejecting an accepted proposal does not roll back the Soul. After a rejection, generating again creates a new independent pending proposal. User B's Soul and proposal list remain untouched.

## Soul Ops Console

The admin console is split from the user/demo surfaces and is available at:

```text
GET /ops
GET /api/ops/overview
GET /api/ops/audit-events
POST /api/ops/cleanup-test-users
```

Set `NNZ_OPS_TOKEN` before enabling it. Without this env var, `/ops` renders a disabled state and `/api/ops/*` returns 404. With it configured, API calls must include either `x-ops-token: <token>` or `Authorization: Bearer <token>`.

`NNZ_OPS_TOKEN` is backward-compatible and maps to the `admin` role. Optional role-specific tokens can be configured:

- `NNZ_OPS_VIEWER_TOKEN`
- `NNZ_OPS_OPERATOR_TOKEN`
- `NNZ_OPS_ADMIN_TOKEN`

Roles:

- `viewer`: overview and audit query only
- `operator`: overview plus cleanup dry-run
- `admin`: overview, dry-run, and confirmed cleanup deletion

Use the protected role token smoke before relying on role-specific cloud tokens:

```bash
npm run ops:role-smoke -- --base-url https://nnz-kego.onrender.com --confirm RUN_OPS_ROLE_TOKEN_SMOKE
```

It reads `NNZ_OPS_VIEWER_TOKEN`, `NNZ_OPS_OPERATOR_TOKEN`, and `NNZ_OPS_ADMIN_TOKEN` from the local shell, sends them only as request headers, and prints env names/check results only. Default mode is non-destructive. The optional confirmed cleanup path requires both `--include-delete` and `--delete-confirm RUN_OPS_ROLE_TOKEN_DELETE_SMOKE`.

Store helper:

- `buildSoulMaturityReport(scope)`

The overview is still scoped by `userId + personaId` for every persona and summarizes:

- Soul maturity score and level
- evidence coverage, identity clarity, voice consistency, memory reliability, runtime stability, and safety readiness
- memory, proposal, snapshot, node, and runtime state counts
- backend recommendations such as `ASK_MORE_MEMORY`, `REVIEW_PROPOSAL`, `SUGGEST_SEAL`, and `READY_FOR_NODE`
- recent ops audit events for overview reads, access denials, cleanup dry-runs, and cleanup deletion attempts

`GET /api/ops/audit-events` supports audit query filters:

- `action=ACCESS_DENIED|OVERVIEW_READ|CLEANUP_DRY_RUN|CLEANUP_DELETE|AUDIT_QUERY`
- `actor=ops:viewer|ops:operator|ops:admin|ops:legacy-admin`
- `targetUserId=user_...`
- `limit=20`
- `offset=0`

Audit queries are themselves recorded as `AUDIT_QUERY` events. The `/ops` page has a dedicated `Audit` tab for these filters and pagination.

`POST /api/ops/cleanup-test-users` defaults to dry-run. Actual deletion requires `dryRun:false` and `confirm:"DELETE_TEST_USERS"`. The cleanup matcher is intentionally conservative and only targets explicit smoke/test accounts such as `@example.test`, `codex-postgres-smoke-*`, `codex-ops-smoke-*`, and `nnz-smoke-*`. It deletes via `store.deleteUserScopedData(userId)`, so one user's Soul, Memory, Node, Conversation, Credential, and Session are removed without crossing into other users.

Ops audit events are admin-only objects. They are persisted with the current store snapshot, rendered only in `/ops`, and must not include token values, chat content, or uploaded memory source text.

Confirmed cleanup deletion returns `receipts` with the deleted user's id, display name/email, cleanup reason, pre-delete counts, deletion timestamp, and status.

This console is intentionally admin-facing. The user-facing app, WeChat flow, and `/demo` validation page should not expose Soul internals such as `SoulVersion`, `SoulSnapshot`, `SoulUpdateProposal`, evidence chains, or scope ids.

## LLM Chat And Extraction

The demo supports OpenAI-compatible LLM providers through environment variables:

```text
NNZ_LLM_API_KEY
NNZ_LLM_BASE_URL
NNZ_LLM_MODEL
```

When configured, `/api/chat` calls the LLM separately for user A and user B. The prompt uses only that user's own Soul, allowed runtime memories, recent conversations, relationship, pet phrases, and node context. If the adapter is unavailable, a reply is empty, or a reply leaks backend mechanism terms, the demo falls back to deterministic runtime output.

The extraction pipeline is also scope-private:

- Every `userId + personaId` tracks its own extraction cursor.
- Every 5 new conversation messages can trigger extraction over the last 10 messages.
- Extracted facts become `CHAT_EXCERPT` memories.
- High-confidence whitelisted fields can create `SoulUpdateProposal`.
- Proposals still require review; they do not silently mutate Soul.

## Demo Persistence And Auth

Demo runtime persistence defaults to the current snapshot path:

```text
NNZ_RUNTIME_PERSISTENCE_MODE=snapshot
```

Postgres snapshot persistence can be enabled with either:

```text
DATABASE_URL=postgres://...
NNZ_POSTGRES_URL=postgres://...
```

When this is configured, the demo loads and saves a store snapshot in Postgres before starting the server. `/healthz` reports `fixture: "postgres"` and includes a non-secret persistence diagnostic:

```json
{
  "persistence": {
    "mode": "postgres",
    "runtimeMode": "snapshot",
    "requestedRuntimeMode": null,
    "postgresConfigured": true,
    "postgresEnv": "DATABASE_URL",
    "scopedPostgresConfigured": false,
    "scopedPostgresEnv": null,
    "sqliteConfigured": false
  }
}
```

The diagnostic returns only env key names and booleans. It never returns database URLs or secret values.

The future scoped-table runtime path is guarded behind:

```text
NNZ_RUNTIME_PERSISTENCE_MODE=scoped
NNZ_POSTGRES_SCOPED_RUNTIME_URL=postgres://...
```

This mode intentionally ignores `DATABASE_URL` and `NNZ_POSTGRES_URL` and requires the dedicated scoped runtime env key. Without that key it fails fast instead of falling back to snapshot Postgres. It also rejects `NNZ_POSTGRES_SCOPED_RUNTIME_URL` when its value matches `DATABASE_URL` or `NNZ_POSTGRES_URL`.
With Step 2.24-2.34, the guarded scoped mode initializes the scoped Postgres schema and routes `/api/me/*` runtime calls through the Postgres scoped runtime adapter when `NNZ_POSTGRES_SCOPED_RUNTIME_URL` is present. Scoped mode also has Ops cleanup/audit/overview cutover slices and user data sovereignty endpoints: cleanup dry-run/confirm, Ops audit query/write, `/api/ops/overview` user/persona/maturity aggregation, and `/api/me/export` / `/api/me/delete` can use scoped Postgres tables. Use `release:validation-suite` to run release preflight, migration validation, role-specific Ops token smoke, and scoped runtime smoke suite in order before any production switch; default runtime remains `snapshot`.

SQLite demo persistence can be enabled with:

```text
NNZ_DB_PATH=./nnz.db
```

Postgres takes priority over SQLite when both are configured.

Basic email/password auth is available through:

```text
POST /api/register
POST /api/login
```

Important boundary: the homepage H5 flow now maps the authenticated token user to that user's own private Persona and Soul. The developer page `/demo` still uses the A/B fixture for scope-isolation checks. Soul Ops now lives under the separate protected `/ops` admin surface.

## Homepage H5 Private Chat

The homepage `/` now includes a user-facing H5 verification flow:

- register or log in
- create a remembered person
- send a private chat message

It uses auth-aware endpoints that read `userId` from the JWT:

```text
GET /api/me
GET /api/me/export
POST /api/me/delete
GET /api/me/personas
POST /api/me/persona
GET /api/me/chat-history?personaId=...
POST /api/me/chat
```

`GET /api/me/export` returns the authenticated user's own data archive, including their personas, Soul versions, snapshots, memories, proposals, nodes, conversations, sessions, and account email metadata. It intentionally excludes credential password hashes and admin-only Ops audit internals. `POST /api/me/delete` requires `confirm:"DELETE_MY_DATA"` and deletes only the authenticated user's scoped data; in scoped Postgres mode this is a `nnz_users` delete with scoped FK cascade.

The developer page `/demo` still exists for A/B scope-isolation checks. Do not expose `/demo` internals as the user product surface. Admin governance belongs under `/ops`.

## Future Shared Memorial Boundary

Family co-creation is not part of the MVP. If it is added later, it must be implemented as a separate `Shared Memorial Space` with explicit invite, authorization, revocation, and a distinct shared Soul. It must never overwrite a user's private Soul.

## Verification

```bash
npm run typecheck
npm test
npm run build:demo
npm run demo
```

Current verified suite on 2026-07-07: 32 test files / 204 tests plus two skipped opt-in Postgres integration tests across domain scope, scoped repositories, scoped runtime adapter/persistence, scoped user export/delete, scoped Ops cleanup/audit/overview, Soul Ops cleanup/overview/audit query/RBAC, runtime persistence config guardrails, SQLite/Postgres snapshot persistence, Postgres scoped repository, snapshot export, snapshot migration planner/row builder/executor/readiness/smoke/validation-suite CLI guardrails, Soul Ops role token smoke CLI guardrails, release preflight/validation-suite CLI guardrails, scoped runtime smoke CLI guardrails, scoped runtime HTTP smoke CLI guardrails, scoped runtime smoke suite guardrails, auth, runtime, LLM prompt contract, safety guard, LLM adapter, and extraction orchestrator. Local `/api/me/*` smoke also passes for register, persona creation, chat, history, seal, activate node, and complete node.

Offline StoreSnapshot export:

```bash
npm run snapshot:export -- --from-sqlite <sqlite-db-path> --out <snapshot-json-path>
npm run snapshot:export -- --from-json <snapshot-or-wrapper-json-path> --out <snapshot-json-path>
```

The export command only reads explicit local files. It does not read `DATABASE_URL`, `NNZ_POSTGRES_URL`, or connect to Postgres. Its output JSON is a full raw `StoreSnapshot`, so it may contain memory text, chat content, credential hashes, and ops audit metadata. Keep exported snapshots local and use the sanitized migration report for review.

Offline snapshot migration dry-run:

```bash
npm run migration:plan -- <snapshot-json-path>
npm run migration:plan -- --json <snapshot-json-path>
npm run migration:plan -- --summary <snapshot-json-path>
npm run migration:plan -- --report <report-json-path> <snapshot-json-path>
```

The command accepts a raw `StoreSnapshot` JSON object or a wrapper with `snapshot_json`, prints scoped table row counts plus warnings/errors, and exits with code 2 when blocking migration errors exist. `--summary` prints aggregate counts/code/table buckets only, without issue messages or ids. `--report` writes a sanitized JSON report with counts and issue identifiers only, excluding memory and chat content. It does not read `DATABASE_URL` or connect to Postgres.

One-command migration readiness bundle:

```bash
npm run migration:readiness -- --from-json <snapshot-or-wrapper-json-path> --snapshot-out <raw-snapshot-json-path> --report-out <sanitized-report-json-path> --summary-out <sanitized-summary-json-path>
npm run migration:readiness -- --from-sqlite <sqlite-db-path> --snapshot-out <raw-snapshot-json-path> --report-out <sanitized-report-json-path> --summary-out <sanitized-summary-json-path>
```

This command is offline only. It creates a raw local snapshot plus sanitized report and summary outputs, refuses accidental overwrites by default, and does not read or connect to any Postgres environment. Use it when a real local snapshot or SQLite file is available.

Protected snapshot migration execution:

```bash
npm run migration:execute -- --snapshot <snapshot-json-path>
npm run migration:execute -- --snapshot <snapshot-json-path> --execute --database-url-env NNZ_POSTGRES_INTEGRATION_URL --confirm EXECUTE_POSTGRES_SCOPED_MIGRATION
```

Default mode is a protected dry-run that reads only the explicit local snapshot file and prints sanitized counts. Execution mode refuses `DATABASE_URL` and `NNZ_POSTGRES_URL`; it only reads `NNZ_POSTGRES_INTEGRATION_URL`, rejects it if its value matches `DATABASE_URL` or `NNZ_POSTGRES_URL`, requires the explicit confirm string, rejects blocking errors, and rejects warnings unless `--allow-warnings` is passed after review. Pool close failures are reported with fixed sanitized text. This is for disposable database validation, not production migration.

Disposable Postgres migration smoke:

```bash
npm run migration:smoke -- --database-url-env NNZ_POSTGRES_INTEGRATION_URL --confirm RUN_POSTGRES_SCOPED_MIGRATION_SMOKE
```

This command is for disposable database validation only. It creates scoped fixture data, executes the migration twice, reads back through `PostgresScopedSoulRepository`, verifies cross-scope rejection and cascade delete, then attempts fixture cleanup. It refuses `DATABASE_URL`, rejects `NNZ_POSTGRES_INTEGRATION_URL` when it matches `DATABASE_URL` or `NNZ_POSTGRES_URL`, and does not print database URLs or fixture row content, including pool close failures.

Combined migration readiness and disposable Postgres validation suite:

```bash
npm run migration:validation-suite -- --from-json <snapshot-or-wrapper-json-path> --snapshot-out <raw-snapshot-json-path> --report-out <sanitized-report-json-path> --summary-out <sanitized-summary-json-path> --database-url-env NNZ_POSTGRES_INTEGRATION_URL --confirm RUN_POSTGRES_SCOPED_MIGRATION_VALIDATION_SUITE
npm run migration:validation-suite -- --from-sqlite <sqlite-db-path> --snapshot-out <raw-snapshot-json-path> --report-out <sanitized-report-json-path> --summary-out <sanitized-summary-json-path> --database-url-env NNZ_POSTGRES_INTEGRATION_URL --confirm RUN_POSTGRES_SCOPED_MIGRATION_VALIDATION_SUITE
```

This command is the preferred target-1/2 validation entry once a real local snapshot and a disposable Postgres database are available. It first runs offline `migration:readiness`; only if readiness exits cleanly does it run `migration:smoke` against `NNZ_POSTGRES_INTEGRATION_URL`. It refuses `DATABASE_URL`, rejects disposable URL alias conflicts, writes the same raw snapshot/report/summary outputs as readiness, and does not print database URLs, memory/chat text, credential hashes, raw snapshot data, row payloads, child command output, or raw error details.

Disposable Postgres scoped runtime smoke:

```bash
npm run runtime:smoke -- --database-url-env NNZ_POSTGRES_SCOPED_RUNTIME_URL --confirm RUN_POSTGRES_SCOPED_RUNTIME_SMOKE
```

This command is for disposable scoped runtime validation only. It creates two scoped user/persona fixtures through the runtime adapter, verifies credential/persona/runtime context readback, Covenant transitions, cross-scope rejection, cascade delete, sibling preservation, and cleanup. It refuses `DATABASE_URL`, rejects `NNZ_POSTGRES_SCOPED_RUNTIME_URL` when it matches `DATABASE_URL` or `NNZ_POSTGRES_URL`, and does not print database URLs or fixture row content, including pool close failures.

Disposable Postgres scoped runtime HTTP smoke:

```bash
npm run runtime:http-smoke -- --database-url-env NNZ_POSTGRES_SCOPED_RUNTIME_URL --confirm RUN_POSTGRES_SCOPED_RUNTIME_HTTP_SMOKE
```

This command is for disposable scoped runtime validation through the real demo HTTP surface. Build first with `npm run build:demo`. It starts `dist-cjs/demo-server.js` with `NNZ_RUNTIME_PERSISTENCE_MODE=scoped`, clears `NNZ_LLM_*` provider variables for deterministic local smoke, verifies `/healthz` scoped Postgres diagnostics, then runs `/api/register`, `/api/me/persona`, `/api/me/chat`, `/api/me/chat-history`, Covenant seal/node/complete/graduate, `/api/me/export`, and `/api/me/delete`. It refuses `DATABASE_URL`, rejects scoped runtime URL alias conflicts, attempts fixture cleanup through `/api/me/delete`, and does not print database URLs, tokens, email/password values, memory/chat text, credential hashes, row payloads, server logs, or raw error details.

Combined disposable Postgres scoped runtime smoke suite:

```bash
npm run runtime:smoke-suite -- --database-url-env NNZ_POSTGRES_SCOPED_RUNTIME_URL --confirm RUN_POSTGRES_SCOPED_RUNTIME_SMOKE_SUITE
```

This command is the preferred target-4 validation entry once a disposable scoped runtime database is available. It first runs `runtime:smoke`, then runs `npm run build:demo`, then runs `runtime:http-smoke` with the same guarded scoped runtime env. It accepts `--skip-build` only when the demo server build output is already current. It refuses `DATABASE_URL`, rejects scoped runtime URL alias conflicts, and does not print database URLs, tokens, email/password values, memory/chat text, credential hashes, row payloads, child process output, server logs, or raw error details.

Soul Ops role token smoke:

```bash
npm run ops:role-smoke -- --base-url https://nnz-kego.onrender.com --confirm RUN_OPS_ROLE_TOKEN_SMOKE
```

This command is the preferred target-3 verification entry once Render has role-specific tokens and the same values are available in the local shell as `NNZ_OPS_VIEWER_TOKEN`, `NNZ_OPS_OPERATOR_TOKEN`, and `NNZ_OPS_ADMIN_TOKEN`. It verifies missing/invalid token rejection, viewer overview/audit read, viewer cleanup denial, operator cleanup dry-run, operator delete denial, admin cleanup dry-run, and the admin delete confirmation boundary. Default mode is non-destructive; a real confirmed cleanup check requires `--include-delete --delete-confirm RUN_OPS_ROLE_TOKEN_DELETE_SMOKE`. The command does not print token values, response payloads, user content, cleanup receipts, server logs, or raw network details.

Release preflight:

```bash
npm run release:preflight -- --snapshot <sqlite-or-snapshot-json-path>
npm run release:preflight -- --snapshot-env NNZ_MIGRATION_SNAPSHOT_PATH
```

This command checks whether the three remaining external validation groups have their local prerequisites: a readable snapshot/SQLite input, disposable migration database env, role-specific Ops token envs, and disposable scoped runtime database env. It does not read snapshot contents, connect to databases, send network requests, or print snapshot paths, database URLs, token values, user content, cleanup receipts, server logs, or raw network details.

Release validation suite:

```bash
npm run release:validation-suite -- --from-json <snapshot-or-wrapper-json-path> --snapshot-out <raw-snapshot-json-path> --report-out <sanitized-report-json-path> --summary-out <sanitized-summary-json-path> --confirm RUN_NNZ_RELEASE_VALIDATION_SUITE
npm run release:validation-suite -- --from-sqlite <sqlite-db-path> --snapshot-out <raw-snapshot-json-path> --report-out <sanitized-report-json-path> --summary-out <sanitized-summary-json-path> --confirm RUN_NNZ_RELEASE_VALIDATION_SUITE
```

This is the preferred one-command release validation entry once the external inputs are available. It runs `release:preflight`, `migration:validation-suite`, default non-destructive `ops:role-smoke`, and `runtime:smoke-suite` in order. It does not run confirmed Ops cleanup deletion and does not print database URLs, token values, snapshot contents, user content, child command output, server logs, or raw error details.

Cloud Soul Ops status on 2026-06-16: Render has `NNZ_OPS_TOKEN` configured. `/ops` returns 200, `/api/ops/overview` returns 401 without token, 403 with a wrong token, and 200 with the configured token. `POST /api/ops/cleanup-test-users` dry-run returns one explicit smoke/test candidate and deletes nothing. The token value is stored only in Render and must not be committed or documented.

Step 2.3 cloud status on 2026-06-17: `/api/ops/audit-events` and the `/ops` Audit tab are implemented and pushed. GitHub Actions run `27677337466` passed. Render `/healthz` reports Postgres persistence, `/ops` returns 200 and includes the Audit tab, `/api/ops/audit-events` returns 401 without a token and 403 with a wrong token. Step 2.32 adds `ops:role-smoke` for the remaining cloud role-specific token verification after Render has `NNZ_OPS_VIEWER_TOKEN`, `NNZ_OPS_OPERATOR_TOKEN`, and `NNZ_OPS_ADMIN_TOKEN` configured. Step 2.33 adds `release:preflight` to summarize which external inputs are present before running any network or database smoke. Step 2.34 adds `release:validation-suite` to run the remaining validations as one protected sequence.

If CLI verification fails or hangs in the iCloud/Obsidian path, do not assume the source is broken immediately. This directory has shown flaky `node_modules` behavior. A reliable check is to copy a clean git archive to `/tmp`, apply the worktree diff if needed, run `npm ci`, then run the verification commands there.

## Current State

The 2026-06-11 Render Postgres verification and the Step 1 protected Soul Ops prototype are implemented. Render has Postgres snapshot persistence configured and verified. Cloud `/ops` was enabled on 2026-06-16 by configuring `NNZ_OPS_TOKEN` in Render and redeploying. Step 2.1 audit logging, Step 2.2 RBAC/deletion receipts, Step 2.3 audit query UI/API, Step 2.4 in-memory `ScopedSoulRepository`, Step 2.5 minimal `PostgresScopedSoulRepository`, Step 2.6 scoped Covenant lifecycle tables, Step 2.7 proposal/credential/audit tables, Step 2.8 opt-in real Postgres integration test harness, Step 2.9 snapshot migration planner, Step 2.10 local dry-run CLI, Step 2.11 scoped migration row builder, Step 2.12 write-side migration executor core, Step 2.13 executor disposable DB integration harness, Step 2.14 client-bound executor transaction, Step 2.15 StoreSnapshot export CLI, Step 2.16 sanitized migration summary, Step 2.17 protected migration execution CLI, Step 2.18 migration readiness CLI, Step 2.19 disposable migration smoke CLI, Step 2.20 runtime persistence mode guardrail, Step 2.21 migration guardrail hardening, Step 2.22 scoped runtime adapter foundation, Step 2.23 `/api/me/*` InMemory adapter wiring, Step 2.24 guarded scoped runtime Postgres adapter mode, Step 2.25 scoped runtime smoke guard, Step 2.26 scoped Ops cleanup/audit cutover slice, Step 2.27 scoped Ops overview aggregation, Step 2.28 user data export/delete cutover, Step 2.29 scoped runtime HTTP smoke CLI, Step 2.30 scoped runtime smoke suite, Step 2.31 migration validation suite, Step 2.32 Ops role token smoke CLI, Step 2.33 release preflight CLI, and Step 2.34 release validation suite CLI are implemented locally. The 2026-07-01 migration readiness roadmap tracks the remaining Step 2 goals in `../nnz-mvp-2026-07-01-Step2-MigrationReadinessRoadmap.md`.

Remaining Step 2 goals: run `release:validation-suite` after the snapshot, disposable DB URLs, and role token envs are available. If a stage fails, fix that stage and rerun the suite.

Next engineering steps: inject external inputs, run `release:validation-suite`, and only split into individual stage commands when a failure needs focused diagnosis.
