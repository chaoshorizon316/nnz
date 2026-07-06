# nnz-mvp 2026-07-06 Step 2.27 Scoped Ops Overview

## 当前结论

Step 2.27 已把 scoped runtime 模式下的 `/api/ops/overview` 用户/persona/maturity 聚合切到 scoped Postgres tables：

- scoped Ops store 新增 `buildOverview(persistence)`。
- overview 会从 `nnz_users`、`nnz_personas`、Soul/Memory/Proposal/Node/Conversation/Session/Credential/OpsAudit scoped tables 读取数据。
- 读取结果在后台内部重建临时 `InMemorySoulStore` snapshot，并复用现有 `buildOpsOverview()` 与 Soul maturity 计算。
- scoped mode 下 `/api/ops/overview` 不再把 users/personas/maturity 建在 demo fixture store 上。

这一步仍不改变默认 runtime：默认 `snapshot` 路径继续走原 store。真实 disposable DB smoke 仍待外部 `NNZ_POSTGRES_SCOPED_RUNTIME_URL`。

## 代码变更

修改：

```text
nnz-mvp/src/ops/postgres-scoped-ops-store.ts
nnz-mvp/src/ops/postgres-scoped-ops-store.test.ts
nnz-mvp/src/demo-server.ts
```

## 行为变化

`PostgresScopedOpsStore`：

- `buildOverview()` 读取 scoped Postgres tables 并生成完整 Ops overview。
- maturity score / recommendations 继续复用现有算法，避免 InMemory 和 Postgres 分叉。
- overview 返回摘要、counts、maturity 和 audit，不返回 memory/chat 正文或 credential hash。
- JSONB scalar string 兼容普通 JS string 与 JSON string。

`demo-server`：

- scoped mode 下 `buildCurrentOpsOverview()` 调用 `scopedRuntimePersistence.ops.buildOverview(...)`。
- snapshot / SQLite / JSONB snapshot mode 行为不变。

## 验证

本地验证：

```text
npm test -- src/ops/postgres-scoped-ops-store.test.ts --reporter verbose
npm run typecheck
npm test
npm run build:demo
```

结果：

```text
targeted scoped ops overview tests: 4 passed
typecheck: passed
full test suite: 26 test files passed, 2 skipped; 155 tests passed, 2 skipped
build:demo: passed
```

## 仍未完成

- 用户级 export/delete API 尚未实现 scoped cutover。
- 尚未用真实 disposable `NNZ_POSTGRES_SCOPED_RUNTIME_URL` 实跑 `runtime:smoke` 或 `/api/me/*` scoped Postgres HTTP smoke。
- scoped mode 暂不运行 extraction pipeline；后续需要 scoped proposal/evidence/extraction flow 后再开启。
