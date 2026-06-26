# nnz-mvp 2026-06-26 Step 2.10：snapshot migration dry-run CLI

## 目标

Step 2.10 的目标是在 Step 2.9 纯函数 planner 之上补一个本地 dry-run CLI，让后续拿到真实 `StoreSnapshot` JSON 样本时，可以离线审阅 snapshot -> scoped tables 迁移计划。

本阶段仍不做线上写入：

- 不读取 `DATABASE_URL`。
- 不连接 Render 生产库。
- 不执行 `INSERT` / `DELETE` / `UPDATE`。
- 不切换 demo runtime persistence。

## 范围

新增命令：

```text
npm run migration:plan -- <snapshot-json-path>
npm run migration:plan -- --json <snapshot-json-path>
npm run migration:plan -- --report <report-json-path> <snapshot-json-path>
```

输入支持：

- 原始 `StoreSnapshot` JSON object。
- `{ "snapshot_json": { ... } }` wrapper。
- `{ "rows": [{ "snapshot_json": { ... } }] }` wrapper。

输出支持：

- 默认人类可读 summary：ready、totalRows、每表 row count、warnings、errors。
- `--json` 原样输出 `PostgresScopedMigrationPlan`。
- `--report` 写入 sanitized JSON report，仅包含 table counts、issue code、table、id，不包含 memory / conversation / credential / token 内容。

退出码：

- `0`: dry-run plan ready，无 blocking errors。
- `1`: CLI 使用错误或 JSON 解析错误。
- `2`: planner 有 blocking errors，需要先修复/解释 snapshot。

## 实施结果（2026-06-26）

已完成本地 dry-run CLI：

- 新增 `src/tools/postgres-scoped-migration-plan-cli.ts`。
- 新增 `src/tools/postgres-scoped-migration-plan-cli.test.ts`。
- `package.json` 新增 `migration:plan` script。
- script 使用 `node --import tsx ...`，避免 `tsx` CLI 在当前沙盒中尝试创建 IPC pipe 导致 `EPERM`。
- CLI 只读本地 JSON 文件，不读取任何数据库环境变量。
- CLI 支持 `--report` 生成可分享/可归档的 sanitized report，不携带聊天或记忆正文。

## 本地验证

```text
npm run typecheck: passed
npm test -- src/tools/postgres-scoped-migration-plan-cli.test.ts --reporter verbose: passed, 4 tests
npm run migration:plan -- --help: passed
npm run migration:plan -- /tmp/nnz-migration-snapshot.json: passed
npm run migration:plan -- --report /tmp/nnz-migration-report.json /tmp/nnz-migration-sensitive-snapshot.json: passed
sanitized report content check: passed, no sensitive memory/chat text
npm test: passed, 15 test files / 94 tests, 1 integration file skipped
npm run build:demo: passed
git diff --check: passed
```

尚未执行：

```text
NNZ_POSTGRES_INTEGRATION_URL=... npm test -- src/domain/postgres-scoped-soul-repository.integration.test.ts
npm run migration:plan -- <real-store-snapshot.json>
```

原因：本轮仍未提供一次性测试库连接串或真实 `StoreSnapshot` 样本；为避免误连 Render / production database，未自动读取 `DATABASE_URL` 或其他环境变量。

## 下一步

1. 使用一次性 Postgres 测试库实际运行 Step 2.8 opt-in integration test。
2. 导出真实 `StoreSnapshot` 样本到本地 JSON 文件。
3. 使用 `npm run migration:plan -- --report <report-json-path> <real-store-snapshot.json>` 审阅 sanitized dry-run report。
4. 只有 dry-run plan 可解释且无 blocking errors 后，再设计实际 snapshot -> scoped tables 迁移执行器。

## 产品与伦理边界

本阶段是后端数据可靠性工作，不新增用户前台功能。

符合产品红线：

- 不改变 Covenant 节奏。
- 不增加用户依赖。
- 不向用户暴露 repository / scope / snapshot / migration 等机制。
- 为未来数据主权、删除、导出和毕业流程打基础。
