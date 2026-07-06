# nnz-mvp 2026-07-03 Step 2.26 Scoped Ops Cleanup Audit

## 当前结论

Step 2.26 已完成 scoped Postgres runtime 模式下 Ops cleanup/audit 的第一段切换：

- 新增 Postgres scoped Ops store，和 scoped runtime adapter 共享同一个 Postgres pool。
- scoped 模式下 `/api/ops/cleanup-test-users` 的 dry-run / confirm 删除会读取 scoped tables，并通过 `DELETE FROM nnz_users WHERE id = $1` 触发 scoped FK cascade。
- scoped 模式下 Ops audit 写入与查询会走 `nnz_ops_audit_events`，不再落到内存 fixture。
- snapshot / SQLite / JSONB snapshot 默认路径不变，仍走原来的 `InMemorySoulStore` Ops helpers。

这一步不是完整 Ops overview 重写：scoped 模式下 overview 的 cleanup plan 与 audit overview 已接 scoped tables；用户/persona maturity 大表仍待后续切到 scoped repository 聚合。

## 代码变更

新增：

```text
nnz-mvp/src/ops/postgres-scoped-ops-store.ts
nnz-mvp/src/ops/postgres-scoped-ops-store.test.ts
```

修改：

```text
nnz-mvp/src/runtime/scoped-runtime-persistence.ts
nnz-mvp/src/demo-server.ts
```

## 行为变化

Postgres scoped Ops store：

- `buildTestUserCleanupPlan()` 从 `nnz_users` + `nnz_credentials` 找 explicit smoke/test accounts。
- `cleanupTestUsers(true)` 保持 read-only。
- `cleanupTestUsers(false)` 删除计划内 test users，并返回 receipts。
- `recordOpsAuditEvent()` 写入 `nnz_ops_audit_events`。
- `queryOpsAuditEvents()` 支持 action / actor / targetUserId / limit / offset。
- cleanup counts 通过 scoped table joins 统计，避免 persona-only 查询。

demo-server：

- scoped runtime 初始化后，`scopedRuntimePersistence.ops` 可用于 Ops cleanup/audit。
- scoped mode 下 Ops access denial、overview read、audit query、cleanup dry-run/delete audit 写入 scoped Postgres audit table。
- scoped mode 下 cleanup preview / confirmed cleanup 使用 scoped Postgres cleanup store。
- snapshot mode 行为不变。

## 验证

本地验证：

```text
npm test -- src/ops/postgres-scoped-ops-store.test.ts src/runtime/scoped-runtime-persistence.test.ts src/ops/ops-console.test.ts --reporter verbose
npm run typecheck
npm test
npm run build:demo
```

结果：

```text
targeted scoped ops tests: 9 passed
typecheck: passed
full test suite: 26 test files passed, 2 skipped; 154 tests passed, 2 skipped
build:demo: passed
```

## 仍未完成

- scoped mode Ops overview 的 user/persona maturity 大表仍是 snapshot fixture 路径，需要后续 scoped repository aggregation。
- 用户级 export/delete API 尚未实现 scoped cutover。
- 尚未用真实 disposable `NNZ_POSTGRES_SCOPED_RUNTIME_URL` 实跑 `runtime:smoke` 或 `/api/me/*` scoped Postgres HTTP smoke。
- scoped mode 暂不运行 extraction pipeline；后续需要 scoped proposal/evidence/extraction flow 后再开启。
