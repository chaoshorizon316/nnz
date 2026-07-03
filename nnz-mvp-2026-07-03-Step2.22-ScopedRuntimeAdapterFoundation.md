# nnz-mvp 2026-07-03 Step 2.22 Scoped Runtime Adapter Foundation

## 当前结论

Step 2.22 已完成 scoped runtime adapter foundation：新增一个双后端 `ScopedRuntimeAdapter`，把 auth/user/persona 这类全局入口和绑定 `userId + personaId` 的 runtime 操作拆开，为后续把 `/api/me/*` 从 snapshot persistence 切到 scoped tables 做准备。

这一步不是 runtime cutover。默认 demo runtime 仍走现有 snapshot / SQLite / memory 路径；`NNZ_RUNTIME_PERSISTENCE_MODE=scoped` 仍应保持受保护，直到 `/api/me/*`、chat、Covenant、cleanup/export/delete 等路径完成接入并通过 smoke。

## 代码变更

新增：

```text
nnz-mvp/src/runtime/scoped-runtime-adapter.ts
nnz-mvp/src/runtime/scoped-runtime-adapter.test.ts
```

主要接口：

```ts
createScopedRuntimeAdapter(driver)
createInMemoryScopedRuntimeAdapter(store)
createPostgresScopedRuntimeAdapter(pool)
ScopedRuntimeAdapter
ScopedPersonaRuntimeAdapter
```

`ScopedRuntimeAdapter` 负责：

- 创建 user。
- 写入 / 查询 credential。
- 创建 persona。
- 按 user 列出 personas。
- 通过 `forPersona({ userId, personaId })` 进入绑定 scope 的 runtime adapter。

`ScopedPersonaRuntimeAdapter` 负责：

- 读取当前 persona。
- 创建 / 读取 SoulVersion。
- 增加 / 列出 Memory。
- 增加 / 列出 Conversation。
- 创建 Node。
- 读取 SoulSnapshot / RuntimeSession。
- 构建 RuntimeContext。
- 执行 `sealSoul()` / `activateNode()` / `completeNode()` / `graduateSoul()`。

## 后端实现

### InMemory 后端

`createInMemoryScopedRuntimeAdapter(store)` 包住现有 `InMemorySoulStore`，作为默认 runtime 行为的语义基线。

它的作用是让后续 demo-server 切换调用形状时，不必一次性改动所有持久化行为；先把 `/api/me/*` 改成 adapter 风格，再把底层从 InMemory / snapshot 切到 Postgres scoped tables。

### Postgres 后端

`createPostgresScopedRuntimeAdapter(pool)` 包住：

- `createPostgresUser`
- `createPostgresPersona`
- `listPostgresPersonasForUser`
- `createPostgresScopedSoulRepositoryFromPool`
- adapter 内部的 `nnz_credentials` helper

Postgres persona runtime 操作继续通过 `PostgresScopedSoulRepository` 绑定完整 `userId + personaId`，避免引入 persona-only 查询路径。

## Covenant 行为

`getRuntimeContext()` 保持现有 Covenant 语义：

- `ACTIVE`：读取 latest SoulVersion + `listRuntimeMemory()`。
- `SEALED`：抛 `CovenantStateError('SEALED')`。
- `NODE`：必须有 `soulSnapshotId`，从同 scope snapshot 重建 archived pseudo soul，并合并 snapshot memory 与 active `NODE_MEMORY`。
- `GRADUATED`：抛 `CovenantStateError('GRADUATED')`。

这保证后续 `/api/me/chat` 接入 adapter 时，用户端仍不会绕过封存 / 节点 / 毕业状态机。

## 验证

本地验证项：

```text
npm test -- src/runtime/scoped-runtime-adapter.test.ts --reporter verbose
npm run typecheck
npm test
npm run build:demo
git diff --check
```

当前结果：

```text
targeted scoped runtime adapter tests: 3 passed
typecheck: passed
full test suite: 141 tests passed, 2 opt-in Postgres integration tests skipped
build:demo: passed
git diff --check: passed
```

## 测试覆盖

新增测试覆盖：

- InMemory adapter 下，同名「爸爸」在 user A / user B 下的 persona、memory、conversation、runtime context 不串 scope。
- credential 可通过 email 取回，且绑定 user。
- NODE runtime context 从 sealed snapshot + node memory 重建。
- SEALED / GRADUATED runtime context 抛 `CovenantStateError`。
- Postgres adapter 使用 fake pool 验证 credential SQL mapping、bound scope、以及调用记录不包含 DB URL。

## 剩余目标

Step 2 仍剩 4 个目标：

1. 用真实本地 snapshot 样本跑 `migration:readiness`。
2. 用一次性 Postgres 测试库跑 `migration:smoke`。
3. 在 Render 验证 viewer/operator/admin role token。
4. 将 `/api/me/*` 与后续 Ops flow 接到 Step 2.22 adapter，并在受保护 scoped runtime mode 后面完成真正 cutover。`/api/me/*` 的 InMemory adapter wiring 已在 Step 2.23 完成，Postgres scoped runtime cutover 仍待推进。

## 下一步建议

Step 2.23 已完成 `/api/me/*` 的 auth/persona/chat/Covenant flow InMemory adapter wiring。下一步继续目标 4：把 `NNZ_RUNTIME_PERSISTENCE_MODE=scoped` 接到 Postgres scoped adapter，并补 scoped Postgres runtime smoke；默认线上路径继续保持 snapshot persistence。
