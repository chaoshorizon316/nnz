# nnz-mvp 2026-06-26 Step 2.11：scoped migration row builder

## 目标

Step 2.11 的目标是在 Step 2.9 planner 和 Step 2.10 dry-run CLI 之后，补一个离线 row builder：当 `StoreSnapshot` 已通过 blocking error 预检时，生成按 scoped table 顺序排列的迁移 rows，为后续真正的 migration executor 做准备。

本阶段仍不做线上写入：

- 不读取 `DATABASE_URL`。
- 不连接 Render 生产库。
- 不执行 `INSERT` / `DELETE` / `UPDATE`。
- 不切换 demo runtime persistence。

## 范围

新增纯函数：

```text
buildPostgresScopedMigrationRows(snapshot, options?)
```

输出：

- 原始 `planPostgresScopedMigration(snapshot)` 结果。
- 按 `POSTGRES_SCOPED_MIGRATION_TABLE_ORDER` 排列的 table rows。
- totalRows。

row builder 覆盖：

- users / personas。
- soul_versions / soul_snapshots。
- memory_items / conversation_messages。
- node_events / runtime_sessions。
- soul_update_proposals。
- credentials。
- ops_audit_events。

## 实施结果（2026-06-26）

已完成离线 row builder：

- 新增 `src/domain/postgres-scoped-migration-rows.ts`。
- 新增 `src/domain/postgres-scoped-migration-rows.test.ts`。
- blocking errors 存在时抛出 `PostgresScopedMigrationRowsError`，不生成 rows。
- NODE session 的 `nodeContext` 会展平为 `node_id` / `node_name`。
- `knowledge_cutoff`、nullable node/session 字段按目标 Postgres table 形态转为 `null`。
- Date / date-like string 统一转 ISO string，便于后续 executor 参数化写入。
- Step 2.10 sanitized report 已接入 row builder，但只输出 rowBuild 的 table counts，不输出 rows 和敏感正文。

## 本地验证

```text
npm run typecheck: passed
npm test -- src/domain/postgres-scoped-migration-rows.test.ts src/tools/postgres-scoped-migration-plan-cli.test.ts --reporter verbose: passed, 10 tests
npm run migration:plan -- --report /tmp/nnz-migration-row-builder-report.json /tmp/nnz-migration-row-builder-snapshot.json: passed
rowBuild sanitized report content check: passed, no rows / sensitive memory / sensitive chat text
npm test: passed, 16 test files / 100 tests, 1 integration file skipped
npm run build:demo: passed
git diff --check: passed
```

尚未执行：

```text
NNZ_POSTGRES_INTEGRATION_URL=... npm test -- src/domain/postgres-scoped-soul-repository.integration.test.ts
npm run migration:plan -- --report <report-json-path> <real-store-snapshot.json>
```

原因：本轮仍未提供一次性测试库连接串或真实 `StoreSnapshot` 样本；为避免误连 Render / production database，未自动读取 `DATABASE_URL` 或其他环境变量。

## 下一步

1. 运行全量本地验证并更新交接状态。
2. 使用一次性 Postgres 测试库实际运行 Step 2.8 opt-in integration test。
3. 导出真实 `StoreSnapshot` 样本到本地 JSON 文件。
4. 使用 `npm run migration:plan -- --report <report-json-path> <real-store-snapshot.json>` 审阅 sanitized dry-run report。
5. 只有 dry-run plan / rowBuild 可解释且无 blocking errors 后，再设计实际 snapshot -> scoped tables migration executor。

## 产品与伦理边界

本阶段是后端数据可靠性工作，不新增用户前台功能。

符合产品红线：

- 不改变 Covenant 节奏。
- 不增加用户依赖。
- 不向用户暴露 repository / scope / snapshot / migration 等机制。
- 为未来数据主权、删除、导出和毕业流程打基础。
