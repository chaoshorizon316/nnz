# nnz-mvp 2026-07-01 Step 2.19 Disposable Migration Smoke CLI

## 目标

把一次性 Postgres 验收从“记得跑两个 integration test，再手动试 protected execution”收敛成一个安全 smoke 命令。拿到 `NNZ_POSTGRES_INTEGRATION_URL` 后，一条命令验证 scoped migration executor、repository 读回、scope 隔离、cascade delete 和清理动作。

## 已完成

- 新增 `src/tools/postgres-scoped-migration-smoke-cli.ts`。
- 新增 `src/tools/postgres-scoped-migration-smoke-cli.test.ts`。
- `package.json` 新增 `migration:smoke` script。

## 使用方式

```bash
npm run migration:smoke -- \
  --database-url-env NNZ_POSTGRES_INTEGRATION_URL \
  --confirm RUN_POSTGRES_SCOPED_MIGRATION_SMOKE
```

## 验证内容

- 构造双 user / 双 persona 的 fixture snapshot。
- 执行 `executePostgresScopedMigration(...)` 两次，验证幂等。
- 通过 `PostgresScopedSoulRepository` 读回 runtime session、snapshot、memory、conversation、proposal、credential。
- 验证跨 scope node conversation 被拒绝。
- 验证 OpsAudit row 写入。
- 删除 user A 后验证 scoped rows cascade delete。
- 验证 user B sibling scope 保留。
- finally 中清理 fixture users 和 audit rows。

## 保护规则

- 必须显式传 `--confirm RUN_POSTGRES_SCOPED_MIGRATION_SMOKE`。
- 只允许 `--database-url-env NNZ_POSTGRES_INTEGRATION_URL`。
- 拒绝 `DATABASE_URL` 和 `NNZ_POSTGRES_URL`。
- stdout 不输出数据库 URL、fixture memory/chat、credential hash、row payload。
- 失败时不输出 raw database error details，只输出 sanitized error code。

## 验证

```text
npm test -- src/tools/postgres-scoped-migration-smoke-cli.test.ts src/tools/postgres-scoped-migration-execute-cli.test.ts src/tools/postgres-scoped-migration-readiness-cli.test.ts src/domain/postgres-scoped-migration-executor.test.ts --reporter verbose: 21 tests passed
npm run typecheck: passed
npm test: 21 files passed, 129 tests passed, 2 integration files skipped
npm run build:demo: passed
npm run migration:smoke -- --help: passed
```

## 仍未完成

- 尚未设置真实 `NNZ_POSTGRES_INTEGRATION_URL` 实跑 smoke。
- 尚未拿真实本地 snapshot 跑 `migration:readiness`。
- 尚未验证 Render role-specific tokens。
- 尚未切换 demo runtime persistence。
