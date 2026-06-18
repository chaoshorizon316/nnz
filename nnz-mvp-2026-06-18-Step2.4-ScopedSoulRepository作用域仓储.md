# nnz-mvp 2026-06-18 Step 2.4：ScopedSoulRepository 作用域仓储

## Summary

本次 Step 2.4 在 Step 2.3 Soul Ops Audit 查询之后，开始为下一阶段“从全量 snapshot persistence 演进到 scoped repositories”打基础。

核心变化：

- 新增 `ScopedSoulRepository`，通过 `bindSoulRepository(store, { userId, personaId })` 先绑定完整 Soul scope。
- 绑定时校验 `userId + personaId` 同时存在，并验证 persona 属于该 user。
- 绑定后所有 Soul / Memory / Snapshot / Proposal / Node / Conversation / Runtime / Maturity 操作都自动携带同一个 scope。
- 调用方即使恶意传入不同 `userId/personaId`，也不能覆盖绑定 scope。
- 现有 API、demo、Postgres/SQLite snapshot persistence 行为不变。

这一步不是数据库拆表本身，而是先把正式 repository 的调用形状固定下来，降低后续拆 Postgres scoped table/repository 时的越权风险。

## Code Changes

新增：

```text
nnz-mvp/src/domain/scoped-soul-repository.ts
nnz-mvp/src/domain/scoped-soul-repository.test.ts
```

修改：

```text
nnz-mvp/src/domain/soul-store.ts
nnz-mvp/src/domain/index.ts
```

`soul-store.ts` 只导出了已有 input interface，供 scoped repository 复用类型；没有改变 store 行为。

`index.ts` 新增 re-export：

```ts
export * from './scoped-soul-repository';
```

## Scoped Repository Contract

入口：

```ts
const repo = bindSoulRepository(store, { userId, personaId });
```

绑定规则：

- 缺少 `userId` 或 `personaId`：抛 `ScopeValidationError`。
- `personaId` 不属于 `userId`：抛 `OwnershipError`。
- 成功绑定后，`repo.scope` 返回当前 scope 的拷贝。

覆盖的操作：

- Persona：`getPersona()`
- Soul：`createSoulVersion()` / `getLatestSoulVersion()` / `listSoulVersions()`
- Snapshot：`createSoulSnapshot()` / `getSoulSnapshot()`
- Memory：`addMemory()` / `listMemory()` / `listRuntimeMemory()` / `listSoulUpdateMemory()`
- Proposal：`createSoulUpdateProposal()` / `listSoulUpdateProposals()` / `listSoulUpdateProposalEvidence()` / `acceptSoulUpdateProposal()` / `rejectSoulUpdateProposal()`
- Node：`createNode()` / `listNodes()`
- Conversation：`addConversation()` / `listConversations()`
- Covenant：`sealSoul()` / `activateNode()` / `completeNode()` / `graduateSoul()`
- Runtime：`getRuntimeSession()` / `getRuntimeContext()`
- Analytics：`buildSoulMaturityReport()`

## Verification

本地工作区通过：

```text
npm ci
npm run typecheck
npx vitest run src/domain/scoped-soul-repository.test.ts src/domain/soul-scope.test.ts
npm run build:demo
npm test
npm audit
```

结果：

```text
npm ci: passed
typecheck: passed
domain scope tests: 2 files passed, 27 tests passed
build:demo: passed
npm test: 12 files passed, 79 tests passed
npm audit: 0 vulnerabilities
```

说明：本次修复前，本地工作区全量 `npm test` 受既有原生依赖架构问题影响：

```text
better-sqlite3 native module is x86_64, current Node needs arm64/arm64e
```

已按干净修复处理：删除旧 `node_modules`，重新 `npm ci` 安装当前架构依赖。随后 SQLite persistence 测试已随全量 `npm test` 通过。

## Scope Audit

本次改动保持以下边界：

- 不新增用户端功能。
- 不暴露任何 Soul Ops / repository / scope 机制到首页 H5、微信端或 AI 回复。
- 不改变 LLM prompt、Memory retrieval、Extraction、Soul Ops RBAC 或 Audit API。
- 不创建全局 `DeceasedSoul`。
- 不允许只按 `personaId` 访问 Soul。
- 不把 A 用户的记忆、纠正、节点、聊天或成熟度报告暴露给 B。

## 下一步计划

建议下一步进入 Step 2.5：Postgres scoped repository 设计与最小落地。

优先顺序：

1. 设计 Postgres scoped tables，不再只依赖 `nnz_store_snapshots.default` 全量 JSON 覆盖。
2. 先迁移最小读路径：`users`、`personas`、`soul_versions`、`runtime_sessions`。
3. 每个 repository 方法都以 `UserPersonaScope` 或绑定后的 `ScopedSoulRepository` 为入口。
4. 保留 snapshot persistence 作为 MVP fallback，避免一次性迁移影响 Render demo。
5. 增加 repository 级越权测试：缺 scope、错 owner、跨 user/persona 查询、删除隔离。
6. 再迁移 Memory / Proposal / Snapshot / Node / Conversation。

云端角色 token smoke 仍待执行：如果 Render 已配置 `NNZ_OPS_VIEWER_TOKEN` / `NNZ_OPS_OPERATOR_TOKEN` / `NNZ_OPS_ADMIN_TOKEN`，下一步也应验证 viewer/operator/admin 的线上权限边界。不要读取或记录 token 明文。
