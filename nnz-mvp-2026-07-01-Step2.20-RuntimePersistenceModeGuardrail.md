# nnz-mvp 2026-07-01 Step 2.20 Runtime Persistence Mode Guardrail

## 结论

已完成 demo runtime persistence mode 护栏。默认运行路径仍是现有 snapshot persistence / SQLite / memory，不改变线上行为。未来 scoped-table runtime 被放到显式 env 后面，并且在真正 adapter 完成前 fail-fast，避免误用 `DATABASE_URL` 或把线上 snapshot 路径误切到半成品 scoped 模式。

## 代码变更

- 新增 `nnz-mvp/src/runtime-persistence-config.ts`
- 新增 `nnz-mvp/src/runtime-persistence-config.test.ts`
- 更新 `nnz-mvp/src/demo-server.ts`
- 更新 `nnz-mvp/src/ops/ops-console.ts`
- 更新 `nnz-mvp/src/ops/ops-console.test.ts`

## 行为

默认模式：

```text
NNZ_RUNTIME_PERSISTENCE_MODE=snapshot
```

或不设置 `NNZ_RUNTIME_PERSISTENCE_MODE` 时，demo 继续沿用原有逻辑：

1. `NNZ_POSTGRES_URL`
2. `DATABASE_URL`
3. `NNZ_DB_PATH`
4. in-memory

未来 scoped runtime 模式：

```text
NNZ_RUNTIME_PERSISTENCE_MODE=scoped
NNZ_POSTGRES_SCOPED_RUNTIME_URL=postgres://...
```

当前 scoped 模式会阻断启动，直到 demo runtime scoped-table adapter 完成。它不会读取 `DATABASE_URL` 或 `NNZ_POSTGRES_URL`，避免把 production snapshot URL 当成 scoped-table runtime URL。

## 诊断

`/healthz` 和 Soul Ops overview persistence info 新增非敏感诊断：

- `runtimeMode`
- `requestedRuntimeMode`
- `scopedPostgresConfigured`
- `scopedPostgresEnv`
- `startupBlocked`
- `startupBlockReason`

诊断只允许返回 env key、boolean 和非敏感状态原因，不返回 database URL、token、memory/chat 正文、credential hash 或 row payload。

## 验证

```text
npm test -- src/runtime-persistence-config.test.ts src/ops/ops-console.test.ts --reporter verbose
npm run typecheck
npm test
npm run build:demo
git diff --check
```

结果：

```text
targeted runtime config / ops tests: 10 tests passed
typecheck: passed
full test: 22 个测试文件、134 tests passed；2 个 integration 文件 skipped
build:demo: passed
git diff --check: passed
```

## 剩余目标

Step 2 仍剩 4 个未完成目标：

1. 用真实本地 snapshot 样本跑 `migration:readiness`。
2. 用一次性 Postgres 测试库跑 `migration:smoke`。
3. 验证 Render viewer/operator/admin role tokens。
4. 在本 guardrail 后实现真正的 demo runtime scoped-table adapter。
