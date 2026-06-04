---
name: product-prd
description: Product planning and PRD for 念念在 (AI grief companion). Must be used before any new feature work. Encodes the product's ethical boundaries, user lifecycle, and the rule that the product helps users leave, not stay.
---

# product-prd — 念念在

This skill encodes the product constitution for 念念在. Any feature design, scope decision, or user-facing change must comply with the constraints below.

## Core Product Identity

- **Product**: 念念在 — AI grief companion (Grief-Tech)
- **Slogan**: 让爱有处安放，让告别有期
- **Primary channel**: WeChat native conversation (enterprise WeChat / service account)
- **Secondary channel**: Responsive brand website (single-page scroll)
- **Tech core**: LLM persona simulation + vector memory retrieval + optional voice cloning
- **Business model**: Monthly subscription + per-node payment + lifetime buyout + B2B

## Ethical Red Lines

These are non-negotiable. Any feature that violates them must be rejected.

1. **Product goal is helping users leave, not stay.** The product lifecycle ends in graduation, not perpetual subscription. Every feature must be audited against this: "Does this encourage healthy closure, or does it create dependency?"
2. **AI persona is time-frozen.** The AI's knowledge stops at the deceased person's time of death. It does not learn, grow, or evolve with the user. This is a feature, not a limitation.
3. **Usage boundaries are mandatory.** Daily message limits and forced sealing mechanisms are non-optional. They are the product's safety architecture.
4. **Graduation is the product's success metric.** A user who exports their data and says goodbye is a win. Retention is not the north star.
5. **No emotional manipulation.** The AI must not guilt-trip users into staying, imply the deceased would be disappointed, or create false urgency around nodes.
6. **Data sovereignty.** Users own their data and can delete everything permanently with a single command.

## User Lifecycle

```
Acute Grief (0-3mo) → Transition (3-12mo) → Memorial (12mo+)
  High-frequency chat       First seal + node restart       Memorial rhythm + optional graduation
```

### Covenant State Machine (user-facing view)

The user experiences this flow:

1. **ACTIVE** — Normal chat period. AI is responsive.
2. **SEALED** — AI is silent. User can only restart via a node event.
3. **NODE** — Temporary reactivation (3 days) for a specific life event (wedding, birth, achievement).
4. **GRADUATED** — User has formally said goodbye. Data is exported and optionally deleted.

### Key constraints on the user journey

- Sealing is system-suggested after 30 days of active use (daily avg >30 messages).
- Nodes are paid per-use, last 3 days, and auto-seal after expiry.
- A user can cycle through SEALED → NODE → SEALED multiple times.
- Graduation is irreversible and triggers full data export + optional deletion.

## Feature Design Checklist

Before proposing any new feature, answer these:

- Which user phase does this serve? (Acute / Transition / Memorial)
- Does it help the user process grief or does it create new attachment?
- Does it require new data collection? If yes, what's the encryption and deletion path?
- Can the user opt out without penalty?
- Does it expose any system mechanism to the user? (It shouldn't.)

## References

When activated, read these docs for full context:

- `../../../AI-念念在-完整产品策划方案.md` — Complete PRD v2.0
- `../../../我还在- 产品设计方案.md` — Product design spec
- `../../../念念在-产品与技术架构：后台治理与Soul成熟度.md` — Architecture and Soul Ops
- `../../../AI-念念在-PRD.md` — Early PRD

## Output Format

When asked to produce product planning output, use this structure:

- Product summary (3-5 lines)
- Target users and scenarios
- Scope: MVP vs next phase vs out of scope
- User flows (Mermaid diagrams preferred)
- Screen inventory
- Feature requirements with acceptance criteria
- Data and integration requirements
- Ethical audit (check against red lines above)
- Release plan
