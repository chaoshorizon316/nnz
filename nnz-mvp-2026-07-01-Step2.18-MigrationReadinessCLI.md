# nnz-mvp 2026-07-01 Step 2.18 Migration Readiness CLI

## 目标

把真实 snapshot dry-run 从多条手工命令收敛成一个离线 readiness 命令。拿到本地 SQLite 或 StoreSnapshot JSON 后，一次生成 raw snapshot、sanitized report、sanitized summary，方便审阅和接入后续 protected execution。

## 已完成

- 新增 `src/tools/postgres-scoped-migration-readiness-cli.ts`。
- 新增 `src/tools/postgres-scoped-migration-readiness-cli.test.ts`。
- `package.json` 新增 `migration:readiness` script。

## 使用方式

从 JSON / wrapper 输入：

```bash
npm run migration:readiness -- \
  --from-json <snapshot-or-wrapper-json-path> \
  --snapshot-out <raw-snapshot-json-path> \
  --report-out <sanitized-report-json-path> \
  --summary-out <sanitized-summary-json-path>
```

从 SQLite demo persistence 输入：

```bash
npm run migration:readiness -- \
  --from-sqlite <sqlite-db-path> \
  --snapshot-out <raw-snapshot-json-path> \
  --report-out <sanitized-report-json-path> \
  --summary-out <sanitized-summary-json-path>
```

## 保护规则

- 只读显式本地文件。
- 不读取 `DATABASE_URL`、`NNZ_POSTGRES_URL`、`NNZ_POSTGRES_INTEGRATION_URL`。
- 不连接 Postgres。
- 默认拒绝覆盖输出文件；`--force` 才覆盖。
- 拒绝输出路径重复，拒绝输出覆盖输入路径。
- raw snapshot 输出包含敏感数据，只能留在本地。
- report / summary 是 sanitized：只含 counts、issue code/table/id、执行 readiness，不含 memory/chat 正文、credential hash、rows。

## 验证

```text
npm test -- src/tools/postgres-scoped-migration-readiness-cli.test.ts src/tools/postgres-scoped-migration-plan-cli.test.ts src/tools/postgres-scoped-migration-execute-cli.test.ts src/tools/store-snapshot-export-cli.test.ts --reporter verbose: 27 tests passed
npm run typecheck: passed
npm test: 20 files passed, 124 tests passed, 2 integration files skipped
npm run build:demo: passed
npm run migration:readiness -- --help: passed
```

## 仍未完成

- 尚未拿真实本地 snapshot / SQLite 文件跑 readiness。
- 尚未用 disposable DB 跑 repository/executor integration 和 protected execution smoke。
- 尚未验证 Render role-specific tokens。
- 尚未切换 demo runtime persistence。
