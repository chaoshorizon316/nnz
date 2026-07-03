# nnz-mvp 2026-07-03 Step 2.24 Guarded Scoped Runtime Postgres Mode

## 当前结论

Step 2.24 已把 guarded scoped runtime mode 接到 Postgres scoped runtime adapter。设置：

```text
NNZ_RUNTIME_PERSISTENCE_MODE=scoped
NNZ_POSTGRES_SCOPED_RUNTIME_URL=postgres://...
```

时，demo-server 会只读取专用 `NNZ_POSTGRES_SCOPED_RUNTIME_URL`，启动时确保 scoped tables schema，并把 `/api/me/*` 用户端 runtime adapter 指向 Postgres scoped tables。

默认 `snapshot` runtime 不变。缺少 `NNZ_POSTGRES_SCOPED_RUNTIME_URL` 时仍 fail-fast，不会退回 `DATABASE_URL` 或 `NNZ_POSTGRES_URL`。

## 代码变更

新增：

```text
nnz-mvp/src/runtime/scoped-runtime-persistence.ts
nnz-mvp/src/runtime/scoped-runtime-persistence.test.ts
```

修改：

```text
nnz-mvp/src/runtime-persistence-config.ts
nnz-mvp/src/runtime-persistence-config.test.ts
nnz-mvp/src/demo-server.ts
nnz-mvp/src/ops/ops-console.ts
```

## 行为变化

`runtime-persistence-config`：

- `NNZ_RUNTIME_PERSISTENCE_MODE=scoped` 仍忽略 `DATABASE_URL` / `NNZ_POSTGRES_URL`。
- scoped mode 必须提供 `NNZ_POSTGRES_SCOPED_RUNTIME_URL`。
- 提供专用 URL 后不再因为 adapter 未实现而 fail-fast。
- 未提供专用 URL 时仍 fail-fast，错误只出现 env key，不打印 URL。

`demo-server`：

- 新增全局 `ScopedRuntimeAdapter` 来源。
- 默认仍为 `createInMemoryScopedRuntimeAdapter(fixture.store)`。
- scoped mode 下使用 `createPostgresScopedRuntimePersistence(...)`。
- 启动时调用 `ensurePostgresScopedSchema(...)`，再把 `/api/me/*` runtime adapter 指向 Postgres scoped tables。
- scoped mode 下 `persistIfEnabled()` 不写旧 snapshot store。
- scoped mode 下暂不运行旧 extraction orchestrator，避免把 Postgres conversation 交给 InMemory extraction 管线。

Ops diagnostic：

- persistence mode 可显示 `scoped-postgres`。
- diagnostic 仍只返回 env key / boolean，不返回 URL 或 token。

## 验证

本地验证：

```text
npm test -- src/runtime/scoped-runtime-persistence.test.ts src/runtime-persistence-config.test.ts --reporter verbose
npm run typecheck
npm test
npm run build:demo
git diff --check
```

结果：

```text
targeted scoped runtime persistence/config tests: 6 passed
typecheck: passed
full test suite: 24 test files passed, 2 skipped; 142 tests passed, 2 skipped
build:demo: passed
```

默认内存模式 `/api/me/*` smoke：

```text
fixture: in-memory
runtimeMode: snapshot
historyMessages: 2
sealed: SEALED
node: NODE
nodeName: 生日
completed: SEALED
noLeak: true
```

scoped mode missing URL smoke：

```text
NNZ_RUNTIME_PERSISTENCE_MODE=scoped
```

结果：

```text
Failed to start demo server: NNZ_RUNTIME_PERSISTENCE_MODE=scoped requires NNZ_POSTGRES_SCOPED_RUNTIME_URL; DATABASE_URL and NNZ_POSTGRES_URL are intentionally ignored for scoped runtime mode.
```

## 仍未完成

- 尚未使用真实 disposable `NNZ_POSTGRES_SCOPED_RUNTIME_URL` 跑 `/api/me/*` scoped Postgres smoke。
- Ops/cleanup/export/delete 尚未切到 scoped runtime / repository 层。
- scoped mode 暂不运行 extraction pipeline；后续需要 scoped proposal/evidence/extraction flow 后再开启。
- 真实 local snapshot readiness、disposable migration smoke、Render role token smoke 仍依赖外部输入或操作窗口。

## 下一步建议

继续目标 4：用一次性 Postgres 测试库作为 `NNZ_POSTGRES_SCOPED_RUNTIME_URL` 启动 demo-server，跑 `/api/me/*` 注册、创建 persona、聊天、历史、封存、节点重启、完成节点和毕业 smoke。通过后再推进 Ops/cleanup/export/delete 的 scoped repository cutover。
