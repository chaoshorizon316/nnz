# nnz-mvp 2026-07-01 Step 2.17 Protected Migration Execute CLI

## 目标

把 scoped migration executor 从纯 domain helper 推进到受保护 CLI，但仍保持“默认 dry-run、只对 disposable DB 执行、绝不碰线上库”的边界。

## 已完成

- 新增 `src/tools/postgres-scoped-migration-execute-cli.ts`。
- 新增 `src/tools/postgres-scoped-migration-execute-cli.test.ts`。
- `package.json` 新增 `migration:execute` script。

## 使用方式

默认 dry-run，只读显式 snapshot 文件，不连接 Postgres：

```bash
npm run migration:execute -- --snapshot <snapshot-json-path>
```

执行模式必须同时满足：

```bash
npm run migration:execute -- \
  --snapshot <snapshot-json-path> \
  --execute \
  --database-url-env NNZ_POSTGRES_INTEGRATION_URL \
  --confirm EXECUTE_POSTGRES_SCOPED_MIGRATION
```

## 保护规则

- 拒绝 `DATABASE_URL` 和 `NNZ_POSTGRES_URL`。
- 只读取 `NNZ_POSTGRES_INTEGRATION_URL`。
- 不设置 `--execute` 时不会创建 pool，也不会连接数据库。
- 执行前必须先通过 planner；有 blocking errors 时拒绝执行。
- 有 warnings 时默认拒绝执行，必须审阅后显式加 `--allow-warnings`。
- stdout/report 只输出 sanitized counts、table counts、issue code/table/id 和执行状态。
- stdout/report 不输出 row payload、memory/chat 正文、credential hash、数据库 URL 或原始数据库错误详情。

## 验证

```text
npm test -- src/tools/postgres-scoped-migration-execute-cli.test.ts src/tools/postgres-scoped-migration-plan-cli.test.ts src/domain/postgres-scoped-migration-executor.test.ts --reporter verbose: 20 tests passed
npm run typecheck: passed
npm test: 19 files passed, 118 tests passed, 2 integration files skipped
npm run build:demo: passed
npm run migration:execute -- --help: passed
```

## 仍未完成

- 尚未用真实 `NNZ_POSTGRES_INTEGRATION_URL` 跑 disposable DB execution smoke。
- 尚未用真实本地 snapshot 样本跑 `snapshot:export` -> `migration:plan` -> `migration:execute` 完整链路。
- 尚未切换 demo runtime persistence；当前仍是 snapshot JSONB persistence。
