# nnz-mvp 2026-07-03 Step 2.25 Scoped Runtime Smoke Guard

## 当前结论

Step 2.25 已补上 scoped runtime Postgres 切换前的本地防护与烟测入口：

- `NNZ_RUNTIME_PERSISTENCE_MODE=scoped` 现在会拒绝 `NNZ_POSTGRES_SCOPED_RUNTIME_URL` 与 `DATABASE_URL` / `NNZ_POSTGRES_URL` 值相同的生产别名误配。
- 新增 `npm run runtime:smoke`，只允许显式读取 `NNZ_POSTGRES_SCOPED_RUNTIME_URL`，并要求 `RUN_POSTGRES_SCOPED_RUNTIME_SMOKE` confirm。
- `runtime:smoke` 输出只包含聚合检查项，不打印 DB URL、fixture memory/chat、credential hash、row payload 或原始数据库错误。

这一步不改变默认 runtime：默认仍是 `snapshot`。真实 Postgres smoke 仍需要 disposable `NNZ_POSTGRES_SCOPED_RUNTIME_URL`。

## 代码变更

新增：

```text
nnz-mvp/src/postgres-env-alias-guard.ts
nnz-mvp/src/tools/postgres-scoped-runtime-smoke-cli.ts
nnz-mvp/src/tools/postgres-scoped-runtime-smoke-cli.test.ts
```

修改：

```text
nnz-mvp/package.json
nnz-mvp/src/runtime-persistence-config.ts
nnz-mvp/src/runtime-persistence-config.test.ts
nnz-mvp/src/tools/postgres-disposable-env-guard.ts
```

## Smoke 覆盖

`runtime:smoke` 在真实 disposable DB 上会：

- ensure scoped schema；
- 创建两组 user/persona fixture；
- 验证 credential、persona list、runtime context 读回；
- 走 `ACTIVE -> SEALED -> NODE -> SEALED` 与 sibling `GRADUATED`；
- 验证 cross-scope node conversation 被拒绝；
- 删除 user A 并验证 scoped rows 级联删除；
- 验证 user B sibling scope preserved；
- finally 尝试清理 fixture users。

命令：

```text
npm run runtime:smoke -- --database-url-env NNZ_POSTGRES_SCOPED_RUNTIME_URL --confirm RUN_POSTGRES_SCOPED_RUNTIME_SMOKE
```

## 验证

本地验证：

```text
npm test -- src/runtime-persistence-config.test.ts src/tools/postgres-scoped-runtime-smoke-cli.test.ts src/tools/postgres-scoped-migration-smoke-cli.test.ts --reporter verbose
npm run typecheck
npm run runtime:smoke -- --help
npm test
npm run build:demo
```

结果：

```text
targeted guard/runtime smoke tests: 21 passed
typecheck: passed
runtime:smoke --help: passed
full test suite: 25 test files passed, 2 skipped; 151 tests passed, 2 skipped
build:demo: passed
```

## 仍未完成

- 尚未用真实 disposable `NNZ_POSTGRES_SCOPED_RUNTIME_URL` 实跑 `runtime:smoke`。
- 尚未把 Ops/cleanup/export/delete 切到 scoped runtime / repository 层。
- scoped mode 暂不运行 extraction pipeline；后续需要 scoped proposal/evidence/extraction flow 后再开启。
- 真实 local snapshot readiness、disposable migration smoke、Render role token smoke 仍依赖外部输入或操作窗口。
