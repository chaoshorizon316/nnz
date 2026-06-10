# 念念在 MVP Core

This package implements the current MVP core for user-scoped Soul data, Covenant lifecycle, Memory layering, Soul Ops maturity review, LLM chat, extraction, SQLite demo persistence, basic email/password JWT auth, and a homepage H5 private-chat verification flow.

Public demo:

```text
https://nnz-kego.onrender.com
```

The demo may sleep on the free Render tier. The first request after inactivity can take 30-60 seconds.

## Soul Scope Rule

Soul is always scoped by `userId + personaId`.

There is no global `DeceasedSoul`, no cross-user merge, and no automatic family sharing. Two users can both create a persona named `爸爸`, but they receive separate Soul versions, memories, snapshots, nodes, and conversations.

Every Soul, Memory, Snapshot, Node, and Conversation access path must provide both `userId` and `personaId`. Access with only `personaId` is rejected.

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

The demo now includes a lightweight backend governance view for Step 4.5.

Store helper:

- `buildSoulMaturityReport(scope)`

The report is still scoped by `userId + personaId` and summarizes:

- Soul maturity score and level
- evidence coverage, identity clarity, voice consistency, memory reliability, runtime stability, and safety readiness
- memory, proposal, snapshot, node, and runtime state counts
- backend recommendations such as `ASK_MORE_MEMORY`, `REVIEW_PROPOSAL`, `SUGGEST_SEAL`, and `READY_FOR_NODE`

This console is intentionally admin-facing. The user-facing app or WeChat flow should not expose Soul internals such as `SoulVersion`, `SoulSnapshot`, `SoulUpdateProposal`, evidence chains, or scope ids.

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

When this is configured, the demo loads and saves a store snapshot in Postgres before starting the server. `/healthz` reports `fixture: "postgres"`.

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

Important boundary: the homepage H5 flow now maps the authenticated token user to that user's own private Persona and Soul. The developer page `/demo` still uses the A/B fixture for scope-isolation checks and Soul Ops inspection, so it should not be treated as the end-user product surface.

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

The developer page `/demo` still exists for A/B scope-isolation checks and Soul Ops inspection. Do not expose `/demo` internals as the user product surface.

## Future Shared Memorial Boundary

Family co-creation is not part of the MVP. If it is added later, it must be implemented as a separate `Shared Memorial Space` with explicit invite, authorization, revocation, and a distinct shared Soul. It must never overwrite a user's private Soul.

## Verification

```bash
npm run typecheck
npm test
npm run build:demo
npm run demo
```

Current verified suite on 2026-06-10: 64 tests across domain scope, SQLite/Postgres persistence, auth, runtime, LLM prompt contract, safety guard, LLM adapter, and extraction orchestrator.

If CLI verification fails or hangs in the iCloud/Obsidian path, do not assume the source is broken immediately. This directory has shown flaky `node_modules` behavior. A reliable check is to copy a clean git archive to `/tmp`, apply the worktree diff if needed, run `npm ci`, then run the verification commands there.

## Current Next Step

The 2026-06-10 H5/API change has been pushed as `4c21d13`, GitHub Actions is green, and Render smoke passed for `/`, `/demo`, `/healthz`, `/api/register`, `/api/login`, and `/api/me/*`.

Postgres snapshot persistence is implemented in code. Next configure a Render Postgres database and set `DATABASE_URL` or `NNZ_POSTGRES_URL`, then verify `/healthz` reports `fixture: "postgres"` and user data survives a redeploy.
