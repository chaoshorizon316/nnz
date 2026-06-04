---
name: system-architecture
description: Backend, storage, API, permissions, security, and deployment design for 念念在. Enforces the Soul scope rule (userId + personaId), Covenant state machine, memory vault layering, and mechanism leak prevention as the highest-priority architectural invariants.
---

# system-architecture — 念念在

This skill encodes the technical constitution for 念念在. Any backend, storage, API, or security decision must comply with the constraints below. When in doubt, prioritize scope isolation over convenience.

## Highest Priority Rule: Soul Scope

**Every Soul, Memory, Snapshot, Node, and Conversation access path must carry both `userId` and `personaId`.**

Forbidden patterns:

- Querying Soul by `personaId` alone.
- Building a global `DeceasedSoul` entity.
- Cross-user personality aggregation.
- Auto-merging Souls by display name, relationship, or family membership.
- User A's corrections affecting User B's Soul.
- User A's node memories entering User B's retrieval results.
- Deleting User A's data deleting User B's data.

If multi-person co-creation is added later, it must be implemented as a separate **Shared Memorial Space** with explicit invite, authorization, revocation, and a distinct shared Soul. It must never overwrite a private Soul.

## Covenant State Machine

```
ACTIVE -> SEALED -> NODE -> SEALED -> GRADUATED
```

Enforcement rules:

- Only one ACTIVE SoulVersion per `userId + personaId`. Creating a new active version archives the previous one.
- `sealSoul(scope)` creates a SoulSnapshot and moves the session to SEALED.
- `activateNode(scope, nodeName)` only works from SEALED. Reuses an existing active node with the same name.
- `completeNode(scope)` moves back to SEALED and completes the active node.
- `graduateSoul(scope)` moves only that user's session to GRADUATED.
- State changes never affect another user's Soul.

## Memory Vault Layering

Memory is split by usage path, not by a single flag:

| Field | Values | Purpose |
|---|---|---|
| `source` | USER_INPUT, UPLOAD, CONVERSATION, CORRECTION, NODE, SYSTEM | Origin tracking |
| `sensitivity` | LOW, MEDIUM, HIGH, RESTRICTED | Privacy classification |
| `enabledForRuntime` | boolean | Can memory enter runtime reply context? |
| `enabledForSoulUpdate` | boolean | Can memory be used as Soul update evidence? |

Store helper constraints:

- `listRuntimeMemory(scope)` excludes disabled, restricted, and risk-flagged memories.
- `listSoulUpdateMemory(scope)` excludes node memories, risk memories, disabled memories, and restricted memories.
- `createSoulUpdateProposal(...)` rejects evidence IDs not allowed for Soul update in the same scope.

## Soul Update Review

Soul updates are reviewable proposals, not invisible automatic changes:

- Proposals have status: PENDING, ACCEPTED, REJECTED.
- Only whitelisted fieldPaths can be proposed: `affectModel.humorLevel`, `languageModel.petPhrases`, `identityCore.relationship`.
- Accepting/rejecting only works on PENDING proposals.
- Accepted/rejected are terminal states.
- Rejection then regeneration creates a new independent pending proposal.

## Mechanism Leak Prevention

**The AI persona must never mention system mechanisms in user-facing content.**

Banned terms in AI-generated replies:

- userId, personaId, SoulVersion, SoulSnapshot, MemoryItem, SoulUpdateProposal
- kernelJson, scope, retrieval, evidence, enabledForSoul, node memory
- 作用域, 检索, 证据, 节点里的, 不是我本来就知道, 只按, 别人的记忆

Test constant for mechanism leak detection: `MECHANISM_LEAK_TERMS`

## Two-Layer Architecture

| Layer | Audience | Purpose |
|---|---|---|
| User-facing | End users (WeChat, mini program, H5) | Low-friction memory, chat, nodes, memorials |
| Admin console | Ops, content review, product, security teams | Persona management, Soul maturity, proposal review, risk monitoring |

The admin console (Soul Ops Console) must exist as a first-class module. Users must never see admin-internal objects.

## Security Requirements

- All user data encrypted at rest (AES-256-GCM).
- Authentication via WeChat OAuth.
- RBAC for admin console.
- Full audit log for all Soul/Proposal/Memory mutations.
- Permanent deletion must cascade correctly within scope without crossing user boundaries.
- No LLM prompt injection through user-supplied memory or chat content.

## References

When activated, read these docs for full context:

- `../../../AI-念念在-完整产品策划方案.md` — Section 3 (architecture), 5 (LLM), 6 (Covenant), 7 (data), 8 (API), 12 (compliance)
- `../../../念念在-产品与技术架构：后台治理与Soul成熟度.md` — Soul Ops Console design
- `../../../nnz-mvp/CLAUDE_CODE_HANDOFF.md` — Current implementation state
- `../../../nnz-mvp/README.md` — MVP scope and verification

## Output Format

When asked to produce architecture output, use this structure:

- Architecture summary (what problem does this design solve?)
- Mermaid component diagram
- Domain model (types and relationships)
- Storage design (what goes where)
- API surface (endpoints, auth, rate limiting)
- Auth and permission model
- Security and risk controls
- Observability and audit logs
- Deployment strategy
- Testing strategy
- Milestone implementation plan
- Scope audit: does this design preserve the `userId + personaId` boundary?
