# nnz-mvp 2026-07-06 Step 2.31 Migration Validation Suite

## 目标

把剩余目标 1 和目标 2 的执行入口合并：拿到真实本地 snapshot/SQLite 与一次性 Postgres 测试库后，用一个受保护命令先跑 offline readiness；只有 readiness 干净时，才继续连接 disposable DB 跑 migration smoke。

## 已实现

- 新增 `nnz-mvp/src/tools/postgres-scoped-migration-validation-suite-cli.ts`。
- 新增 `nnz-mvp/src/tools/postgres-scoped-migration-validation-suite-cli.test.ts`。
- `nnz-mvp/package.json` 新增：

```json
"migration:validation-suite": "node --import tsx src/tools/postgres-scoped-migration-validation-suite-cli.ts"
```

命令：

```bash
npm run migration:validation-suite -- --from-json <snapshot-or-wrapper-json-path> --snapshot-out <raw-snapshot-json-path> --report-out <sanitized-report-json-path> --summary-out <sanitized-summary-json-path> --database-url-env NNZ_POSTGRES_INTEGRATION_URL --confirm RUN_POSTGRES_SCOPED_MIGRATION_VALIDATION_SUITE
npm run migration:validation-suite -- --from-sqlite <sqlite-db-path> --snapshot-out <raw-snapshot-json-path> --report-out <sanitized-report-json-path> --summary-out <sanitized-summary-json-path> --database-url-env NNZ_POSTGRES_INTEGRATION_URL --confirm RUN_POSTGRES_SCOPED_MIGRATION_VALIDATION_SUITE
```

可选：

```bash
--force
```

`--force` 只转发给 readiness，用于明确覆盖本地输出文件。

## 执行顺序

1. 运行 offline readiness：
   `migration:readiness -- --from-json|--from-sqlite ...`
2. readiness exit 0 后运行 disposable DB smoke：
   `migration:smoke -- --database-url-env NNZ_POSTGRES_INTEGRATION_URL --confirm RUN_POSTGRES_SCOPED_MIGRATION_SMOKE`

如果 readiness exit 1 或 2，suite 停止，不连接 Postgres。

## 安全边界

- 只允许 `--database-url-env NNZ_POSTGRES_INTEGRATION_URL`。
- 必须显式传 `--confirm RUN_POSTGRES_SCOPED_MIGRATION_VALIDATION_SUITE`。
- 拒绝 `DATABASE_URL` / `NNZ_POSTGRES_URL`。
- 拒绝 `NNZ_POSTGRES_INTEGRATION_URL` 与 `DATABASE_URL` 或 `NNZ_POSTGRES_URL` 同值。
- readiness 失败或返回 blocking errors 时不会运行 DB smoke。
- stdout 只输出固定 stage 与输出路径：offlineMigrationReadiness、disposablePostgresMigrationSmoke、raw snapshot、sanitized report、sanitized summary。
- 任一 stage 失败时，只输出固定 stage 失败文案。
- 不拼接子命令 stdout/stderr，避免 raw snapshot、raw DB error、child command output 或 secret 被带出。
- 不打印 DB URL、memory text、chat content、credential hash、raw snapshot data、row payload 或 raw error details。
- 该入口是 protected developer validation，不属于用户前台体验，不新增任何用户可见机制文案。

## 验证

```text
npm test -- src/tools/postgres-scoped-migration-validation-suite-cli.test.ts --reporter verbose: 8 tests passed
npm run migration:validation-suite -- --help: passed
npm run typecheck: passed
npm test: 29 个测试文件、183 tests passed；2 个 integration 文件 skipped
npm run build:demo: passed
git diff --check: passed
```

未实跑真实 disposable DB，因为当前环境未提供 `NNZ_POSTGRES_INTEGRATION_URL`，也没有真实本地 snapshot/SQLite 输入。下一步拿到两者后，直接跑 `migration:validation-suite`。

## 剩余目标

Step 2 仍剩 4 个未完全收口目标：

1. 用真实本地 snapshot 样本和一次性 Postgres 测试库跑 `migration:validation-suite`。
2. 若 readiness 有 blocking errors，审阅 sanitized report 并修数据形状或迁移映射。
3. 在 Render 验证 viewer/operator/admin role tokens。
4. 用 disposable `NNZ_POSTGRES_SCOPED_RUNTIME_URL` 实跑 `runtime:smoke-suite`。
