# nnz-mvp 2026-06-24 Step 2.6：Postgres scoped Covenant 主链计划

## 目标

Step 2.6 继续扩展 Step 2.5 的 Postgres scoped repository，从 Persona / Memory / Conversation 扩到 Covenant 主链。

本阶段仍是旁路最小切片，不替换线上 demo runtime persistence：

- 新增逐表 Postgres schema：SoulVersion、SoulSnapshot、NodeEvent、RuntimeSession。
- 在 `PostgresScopedSoulRepository` 内实现与 `InMemorySoulStore` 对齐的 Covenant 生命周期。
- 用 fake Postgres pool 测试证明 lifecycle 只影响绑定的 `userId + personaId`。

## 本次范围

本阶段包含：

- `nnz_soul_versions`
- `nnz_soul_snapshots`
- `nnz_node_events`
- `nnz_runtime_sessions`
- `createSoulVersion`
- `getLatestSoulVersion`
- `listSoulVersions`
- `createSoulSnapshot`
- `getSoulSnapshot`
- `createNode`
- `listNodes`
- `getRuntimeSession`
- `sealSoul`
- `activateNode`
- `completeNode`
- `graduateSoul`

暂不包含：

- SoulUpdateProposal 逐表 repository。
- OpsAudit / Credential 逐表 repository。
- 替换 demo-server 的 `nnz_store_snapshots` JSONB persistence。
- 真实 Postgres 集成测试和迁移脚本。
- 加密落盘。

## 不可破坏的作用域规则

- 所有新增表都必须携带 `user_id + persona_id`。
- 所有新增查询都必须同时按 `user_id + persona_id` 过滤。
- 创建新 ACTIVE SoulVersion 只能归档同一 scope 里的 ACTIVE 版本。
- Seal / Node / Complete / Graduate 只能影响当前绑定 scope。
- Node conversation 不能引用其他 scope 的 node。
- Snapshot memoryIds 只能来自同一 scope 的 memory。

## 验收标准

本地必须通过：

```text
npm run typecheck
npm test
npm run build:demo
git diff --check
```

新增测试至少覆盖：

- 创建第二个 ACTIVE SoulVersion 只归档当前 scope 的旧 ACTIVE，不影响另一个用户。
- `sealSoul()` 创建 snapshot、归档当前 active soul，并进入 SEALED。
- `activateNode()` 只能从 SEALED 进入 NODE，并复用同名 active node。
- `completeNode()` 只完成当前 scope 的 active node 并回到 SEALED。
- `graduateSoul()` 只把当前 scope 的 soul/session 标记为 GRADUATED。
- `addConversation({ nodeId })` 拒绝引用另一个 scope 的 node。

## 实施结果（2026-06-24）

已完成 Covenant 主链旁路切片：

- `POSTGRES_SCOPED_SCHEMA` 新增 `nnz_soul_versions`、`nnz_soul_snapshots`、`nnz_node_events`、`nnz_runtime_sessions`。
- `PostgresScopedSoulRepository` 新增 SoulVersion、SoulSnapshot、NodeEvent、RuntimeSession 与 Covenant lifecycle 方法。
- `createSoulVersion()` 创建新 ACTIVE 时只归档当前 scope 的旧 ACTIVE。
- `sealSoul()` 创建 snapshot、归档当前 active soul，并把 session 写为 SEALED。
- `activateNode()` 只允许从 SEALED 进入 NODE，优先复用同名 active node，并补一条同 scope 的 NODE_MEMORY。
- `completeNode()` 只完成当前 scope 的 node，并回到 SEALED。
- `graduateSoul()` 只把当前 scope 的 soul versions 和 session 标为 GRADUATED。
- `addConversation({ nodeId })` 新增 node ownership 校验，拒绝引用其他 scope 的 node。
- fake Postgres pool 测试覆盖 schema、作用域隔离、Covenant 状态流转、node 复用/完成、跨 scope node 拒绝。

本阶段仍未替换 demo runtime 的 Postgres snapshot persistence；线上路径继续使用当前稳定的 `nnz_store_snapshots` JSONB 快照。

## 本地验证

```text
npm run typecheck: passed
npm test: passed, 13 test files / 85 tests
npm run build:demo: passed
```

尚未执行：

```text
git diff --check
```

## 产品与伦理边界

本阶段不新增用户前台功能，只增强数据边界和持久化可靠性。

符合产品红线：

- 不改变封存、节点、毕业节奏。
- 不增加让用户停留更久的功能。
- 不向用户暴露 `SoulVersion`、`SoulSnapshot`、`scope`、repository 等机制词。
- 为未来数据导出、删除、毕业后的可靠清理打基础。
