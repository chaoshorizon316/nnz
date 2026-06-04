---
name: miniapp-frontend-guidelines
description: Mobile-first frontend, H5, app, and WeChat mini program design and implementation for 念念在. Enforces the dual-layer UI split (user-facing vs admin console), mechanism leak prevention in all visible text, and platform-specific constraints.
---

# miniapp-frontend-guidelines — 念念在

This skill encodes the frontend constitution for 念念在. Any screen design, component, or user-facing text must comply.

## Platform Selection

| Surface | Platform | Notes |
|---|---|---|
| Primary chat experience | WeChat native conversation (enterprise WeChat API) | Users add 念念在 as a WeChat contact |
| Brand website | HTML + Tailwind CSS CDN + Vanilla JS | Single-page scroll, SEO-friendly, zero build |
| Memory upload | WeChat H5 or mini program sub-page | File upload, text paste |
| Admin console | React/Vue SPA (desktop-first) | Soul Ops Console for internal teams |
| Mini program (future) | WeChat Mini Program | If native chat experience is not sufficient |

## The Two-Layer UI Rule

**User-facing surfaces must never expose system internals.** The user should feel they are talking to a person, not interacting with a database.

### User-visible concepts (allowed)

- Creating a persona: "爸爸", "妈妈", etc.
- Sharing memories, uploading chat records
- Chatting, receiving replies
- Nodes: special moments like weddings, births
- Sealing: "taking a break" or "resting"
- Graduation: "saying a proper goodbye"
- Memorials, data export, deletion

### System concepts (must never appear in UI)

- SoulVersion, SoulSnapshot, SoulUpdateProposal
- MemoryItem, enabledForRuntime, enabledForSoulUpdate
- userId, personaId, scope
- kernelJson, vector, embedding, LLM prompt
- Covenant state machine names (ACTIVE/SEALED/NODE/GRADUATED)
- Evidence chains, proposal review
- 作用域, 检索, 证据, 节点里的, 不是我本来就知道, 只按, 别人的记忆

## Screen Inventory

### Brand Website (single-page scroll)

1. **Hero** — Slogan, value proposition, CTA to WeChat QR code
2. **Core Values** — Why 念念在 is different (help you leave, not keep you)
3. **How It Works** — 4-step visual guide
4. **Ethics and Safety** — Data encryption, graduation mechanism, psychology backing
5. **Pricing** — Tiered plans
6. **User Stories** — Anonymized testimonials
7. **FAQ** — Common concerns
8. **Footer** — WeChat QR, support, compliance

### WeChat Chat Flow (conversational UI)

1. **Onboarding** — Identity selection, persona info, personality description, chat record upload
2. **Active Chat** — Conversational replies, gentle usage reminders
3. **Seal Notice** — System message suggesting a rest period
4. **Node Activation** — User triggers via `#节点 <name>`, payment flow
5. **Node Chat** — 3-day reactivation window
6. **Graduation Flow** — Export, farewell ritual, certificate

### Admin Console (Soul Ops Console)

1. **Dashboard** — Key metrics overview
2. **Persona List** — All personas with status
3. **Memory Vault Inspector** — Browse and audit memories
4. **Soul Kernel Inspector** — View current Soul structure
5. **Proposal Review Queue** — Pending Soul update proposals
6. **Snapshot / Seal Controls** — Manual sealing and snapshot management
7. **Soul Maturity Analytics** — Coverage, clarity, consistency metrics
8. **Risk Event Console** — Flagged conversations and safety alerts
9. **User Lifecycle Dashboard** — Active/sealed/graduated distribution

## Mobile and Mini Program Constraints

- WeChat mini program package size limit: 2MB (main package) + subpackages
- Touch targets minimum 44x44px
- No horizontal scroll on any screen
- Text must fit within its container on 320px width (iPhone SE)
- Loading states for all async operations
- Empty states for all list views (never show blank screens)
- Error states with human-readable messages (never raw error codes)
- Network status awareness (show offline indicator)

## Component Architecture

- Reuse existing design tokens from the brand website: warm color palette (`warm-*`), Noto Serif SC for headings, Noto Sans SC for body
- All user-facing components must pass the mechanism leak check: scan for any term from the banned list
- Chat bubbles: AI replies distinguished from user messages by subtle styling, not mechanistic labels
- Form validation must provide inline, immediate feedback in simple Chinese

## State Ownership

| State | Owner | Notes |
|---|---|---|
| Auth / session | Global context (WeChat OAuth) | |
| Persona list | Per-user, fetched on login | |
| Active chat | Per-conversation, local | Never cross-contaminate between personas |
| Memory upload | Local with progress | Clear after success |
| Admin console data | Per-session, read-only cache | Refresh on navigation |

## References

When activated, read these docs for full context:

- `../../../AI-念念在-完整产品策划方案.md` — Section 2 (user journey), 4 (WeChat design), 9 (frontend spec)
- `../../../我还在- 产品设计方案.md` — Section 3 (website design), 4 (WeChat interaction)
- `../../../念念在-产品与技术架构：后台治理与Soul成熟度.md` — Section 3 (user/admin boundary)
- `../../../nnz-mvp/CLAUDE_CODE_HANDOFF.md` — Step 6 (UI upgrade plan)
- `../../../index.html` — Current brand website prototype

## Output Format

When asked to produce frontend output, use this structure:

- Platform selection and rationale
- Screen and navigation structure (Mermaid flow)
- Component plan with mechanism leak audit
- State ownership map
- Loading, empty, error, and permission states per screen
- Mobile and mini program constraint compliance
- Screenshot or browser verification plan (use screenshot + playwright skills)
