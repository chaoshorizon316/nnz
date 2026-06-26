# nnz-mvp 2026-06-26 Step 2.12：scoped migration executor

## 目标

Step 2.12 的目标是在 Step 2.9 planner、Step 2.10 dry-run CLI、Step 2.11 row builder 之后，补一个 write-side migration executor 的离线可测实现。

本阶段仍不直接迁移线上：

- 不读取 `DATABASE_URL`。
- 不连接 Render 生产库。
- 不提供 CLI 执行入口。
- 不切换 demo runtime persistence。

## 范围

新增函数：

```text
executePostgresScopedMigration(pool, snapshot, options)
```

执行边界：

- 必须显式传入 `confirm: EXECUTE_POSTGRES_SCOPED_MIGRATION_CONFIRM`。
- 默认先运行 `ensurePostgresScopedSchema(pool)`。
- 使用 Step 2.11 row builder 生成 rows。
- 在一个 transaction 中执行：`BEGIN` -> schema -> ordered inserts -> `COMMIT`。
- 任意 insert 失败会 `ROLLBACK`。
- 按目标 scoped table 顺序写入。
- 使用 `ON CONFLICT ... DO UPDATE` 支持幂等重跑；OpsAudit 使用 `ON CONFLICT DO NOTHING`，避免重复审计事件被覆盖。

## 实施结果（2026-06-26）

已完成 executor 内核：

- 新增 `src/domain/postgres-scoped-migration-executor.ts`。
- 新增 `src/domain/postgres-scoped-migration-executor.test.ts`。
- 确认字符串错误时不会执行任何 query。
- fake pool 测试覆盖 schema + ordered inserts + commit。
- fake pool 测试覆盖 `ensureSchema:false`。
- fake pool 测试覆盖 insert 失败 rollback。
- Step 2.10 sanitized report 新增 executor section，标记 `readyForExecution`、`executed:false` 和 required confirm，不执行迁移、不输出 rows。

## 本地验证

```text
npm run typecheck: passed
npm test -- src/domain/postgres-scoped-migration-executor.test.ts src/tools/postgres-scoped-migration-plan-cli.test.ts --reporter verbose: passed, 11 tests
npm test: passed, 17 test files / 104 tests, 2 integration files skipped
npm run build:demo: passed
git diff --check: passed
```

尚未执行：

```text
NNZ_POSTGRES_INTEGRATION_URL=... npm test -- src/domain/postgres-scoped-soul-repository.integration.test.ts
npm run migration:plan -- --report <report-json-path> <real-store-snapshot.json>
executePostgresScopedMigration(...) against a disposable database
```

原因：本轮仍未提供一次性测试库连接串或真实 `StoreSnapshot` 样本；为避免误连 Render / production database，未自动读取 `DATABASE_URL` 或其他环境变量。

## 下一步

1. 用一次性 Postgres 测试库运行现有 Step 2.8 integration test。
2. 为 executor 增加 disposable database integration test，仅使用 `NNZ_POSTGRES_INTEGRATION_URL`。
3. 导出真实 `StoreSnapshot` 样本并跑 sanitized dry-run report。
4. dry-run / executor integration 都通过后，再考虑受保护的执行入口。

## 产品与伦理边界

本阶段是后端数据可靠性工作，不新增用户前台功能。

符合产品红线：

- 不改变 Covenant 节奏。
- 不增加用户依赖。
- 不向用户暴露 repository / scope / snapshot / migration 等机制。
- 为未来数据主权、删除、导出和毕业流程打基础。
