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

`PostgresScopedSoulRepository` is the first table-based Postgres slice. It is a sidecar repository, not yet the demo runtime persistence path. It currently covers `nnz_users`, `nnz_personas`, `nnz_memory_items`, `nnz_conversation_messages`, `nnz_soul_versions`, `nnz_soul_snapshots`, `nnz_node_events`, `nnz_runtime_sessions`, `nnz_soul_update_proposals`, `nnz_credentials`, and `nnz_ops_audit_events`, with every Soul, Memory, Node, Session, Proposal, and Conversation query bound by both `userId` and `personaId`.

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
    "postgresConfigured": true,
    "postgresEnv": "DATABASE_URL",
    "sqliteConfigured": false
  }
}
```

The diagnostic returns only env key names and booleans. It never returns database URLs or secret values.

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
GET /api/me/personas
POST /api/me/persona
GET /api/me/chat-history?personaId=...
POST /api/me/chat
```

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

Current verified suite on 2026-06-26: 100 tests plus one skipped opt-in Postgres integration test across domain scope, scoped repositories, Soul Ops cleanup/overview/audit query/RBAC, SQLite/Postgres snapshot persistence, Postgres scoped repository, snapshot migration planner/row builder/CLI, auth, runtime, LLM prompt contract, safety guard, LLM adapter, and extraction orchestrator.

Offline snapshot migration dry-run:

```bash
npm run migration:plan -- <snapshot-json-path>
npm run migration:plan -- --json <snapshot-json-path>
npm run migration:plan -- --report <report-json-path> <snapshot-json-path>
```

The command accepts a raw `StoreSnapshot` JSON object or a wrapper with `snapshot_json`, prints scoped table row counts plus warnings/errors, and exits with code 2 when blocking migration errors exist. `--report` writes a sanitized JSON report with counts and issue identifiers only, excluding memory and chat content. It does not read `DATABASE_URL` or connect to Postgres.

Cloud Soul Ops status on 2026-06-16: Render has `NNZ_OPS_TOKEN` configured. `/ops` returns 200, `/api/ops/overview` returns 401 without token, 403 with a wrong token, and 200 with the configured token. `POST /api/ops/cleanup-test-users` dry-run returns one explicit smoke/test candidate and deletes nothing. The token value is stored only in Render and must not be committed or documented.

Step 2.3 cloud status on 2026-06-17: `/api/ops/audit-events` and the `/ops` Audit tab are implemented and pushed. GitHub Actions run `27677337466` passed. Render `/healthz` reports Postgres persistence, `/ops` returns 200 and includes the Audit tab, `/api/ops/audit-events` returns 401 without a token and 403 with a wrong token. Cloud role-specific token smoke is the next verification step after Render has `NNZ_OPS_VIEWER_TOKEN`, `NNZ_OPS_OPERATOR_TOKEN`, and `NNZ_OPS_ADMIN_TOKEN` configured.

If CLI verification fails or hangs in the iCloud/Obsidian path, do not assume the source is broken immediately. This directory has shown flaky `node_modules` behavior. A reliable check is to copy a clean git archive to `/tmp`, apply the worktree diff if needed, run `npm ci`, then run the verification commands there.

## Current State

The 2026-06-11 Render Postgres verification and the Step 1 protected Soul Ops prototype are implemented. Render has Postgres snapshot persistence configured and verified. Cloud `/ops` was enabled on 2026-06-16 by configuring `NNZ_OPS_TOKEN` in Render and redeploying. Step 2.1 audit logging, Step 2.2 RBAC/deletion receipts, Step 2.3 audit query UI/API, Step 2.4 in-memory `ScopedSoulRepository`, Step 2.5 minimal `PostgresScopedSoulRepository`, Step 2.6 scoped Covenant lifecycle tables, Step 2.7 proposal/credential/audit tables, Step 2.8 opt-in real Postgres integration test harness, Step 2.9 snapshot migration planner, Step 2.10 local dry-run CLI, and Step 2.11 scoped migration row builder are implemented locally.

Next engineering steps: verify optional role-specific tokens in Render, run the opt-in Postgres integration test against a disposable database, export a real `StoreSnapshot` sample, then run `npm run migration:plan -- --report <report-json-path> <snapshot-json-path>` before designing the write-side migration executor.
