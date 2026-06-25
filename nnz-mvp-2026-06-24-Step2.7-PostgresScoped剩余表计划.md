# nnz-mvp 2026-06-24 Step 2.7：Postgres scoped 剩余表计划

## 目标

Step 2.7 补齐 Step 2.5 / 2.6 之后剩余的关键逐表 repository 能力。

本阶段仍是旁路实现，不替换线上 demo runtime persistence：

- SoulUpdateProposal 逐表存储与审核流程。
- Credential 逐表存储与用户绑定。
- OpsAuditEvent 逐表存储与后台查询基础。

## 本次范围

本阶段包含：

- `nnz_soul_update_proposals`
- `nnz_credentials`
- `nnz_ops_audit_events`
- `createSoulUpdateProposal`
- `listSoulUpdateProposals`
- `listSoulUpdateProposalEvidence`
- `acceptSoulUpdateProposal`
- `rejectSoulUpdateProposal`
- `storeCredential`
- `getCredentialByEmail`
- `recordOpsAuditEvent`
- `listOpsAuditEvents`

暂不包含：

- 替换 demo-server 的 `nnz_store_snapshots` JSONB persistence。
- 真实 Postgres 集成测试。
- snapshot -> tables 迁移脚本。
- 加密落盘。
- Ops Audit 复杂分页查询 API 重写。

## 作用域与安全规则

- Proposal 必须同时绑定 `userId + personaId`。
- Proposal evidenceIds 必须来自同 scope 且允许 Soul Update 的 memory。
- Proposal fieldPath 只能使用白名单：
  - `affectModel.humorLevel`
  - `languageModel.petPhrases`
  - `identityCore.relationship`
- Accept / reject 只能作用于同 scope 且 PENDING 的 proposal。
- Accept 创建新的 ACTIVE SoulVersion，只影响同 scope。
- Credential 只绑定 user，不绑定 persona；删除 user 时未来必须级联删除。
- OpsAudit 是后台对象，不能记录 token 明文、聊天内容或上传资料原文。

## 验收标准

本地必须通过：

```text
npm run typecheck
npm test
npm run build:demo
git diff --check
```

新增测试至少覆盖：

- user A 的 proposal evidence 不能引用 user B 的 memory。
- restricted / risk / node memory 不能作为 proposal evidence。
- accept proposal 只更新 user A + persona A 的 soul，不影响 user B。
- rejected proposal 不能再 accept；accepted proposal 不能再 reject。
- credential 按 user 绑定，email 查回正确 user。
- ops audit 记录可列出，但 metadata 中不出现 token/chat 内容。

## 实施结果（2026-06-24）

已完成剩余关键表旁路切片：

- `POSTGRES_SCOPED_SCHEMA` 新增 `nnz_soul_update_proposals`、`nnz_credentials`、`nnz_ops_audit_events`。
- `PostgresScopedSoulRepository` 新增 proposal 创建、列表、证据读取、接受、拒绝。
- Proposal evidence 校验复用 `listSoulUpdateMemory()`，因此 restricted / risk / node / disabled / cross-scope memory 都不能进入 proposal。
- Proposal fieldPath 复用现有白名单。
- `acceptSoulUpdateProposal()` 会更新 proposal 为 ACCEPTED，并通过 `createSoulVersion()` 创建同 scope 的新 ACTIVE SoulVersion。
- `rejectSoulUpdateProposal()` 只允许 PENDING proposal。
- 新增 `storeCredential()` / `getCredentialByEmail()`，credential 绑定 user 并要求 user 存在。
- 新增 `recordOpsAuditEvent()` / `listOpsAuditEvents()`，用于逐表保存后台 audit 事件。
- fake Postgres pool 测试覆盖 proposal scope/evidence、accept/reject 终态、credential user 绑定、ops audit metadata 安全边界。

本阶段仍未替换 demo runtime 的 Postgres snapshot persistence；线上路径继续使用当前稳定的 `nnz_store_snapshots` JSONB 快照。

## 本地验证

```text
npm run typecheck: passed
npm test: passed, 13 test files / 87 tests
npm run build:demo: passed
git diff --check: passed
```

## 产品与伦理边界

本阶段不新增用户前台功能，只增强数据边界、审计和未来迁移能力。

符合产品红线：

- Soul 更新仍是后台审核，不做隐式自动人格改变。
- 不增加用户依赖，不改变 Covenant 节奏。
- 不向用户暴露 proposal、evidence、scope 等后台机制。
- 为未来数据主权、删除、导出和毕业流程打基础。
