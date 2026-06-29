# nnz-mvp 2026-06-26 Step 2.14：executor client-bound transaction

## 目标

Step 2.14 的目标是修正 Step 2.12 executor 的事务边界：真实 `pg.Pool` 下，`BEGIN` / inserts / `COMMIT` 必须绑定同一个 checked-out client，而不是直接连续调用 `pool.query(...)`。

## 问题

`pg.Pool#query()` 每次调用都可能使用不同连接。迁移 executor 如果用：

```text
pool.query('BEGIN')
pool.query('INSERT ...')
pool.query('COMMIT')
```

就无法保证所有 SQL 落在同一个 transaction 中。对迁移写入来说，这是必须修正的可靠性问题。

## 实施结果（2026-06-26）

已完成：

- `executePostgresScopedMigration(...)` 改为要求 migration pool 支持 `connect()`。
- executor 通过 `const client = await pool.connect()` 获取同一个 client。
- `BEGIN` / `ensurePostgresScopedSchema(client)` / ordered inserts / `COMMIT` / `ROLLBACK` 全部使用同一个 client。
- `finally` 中执行 `client.release()`，成功和失败路径都会释放连接。
- 将 repository 侧类型拆为 `QueryableClient` 与 `QueryablePool`，让 schema/repository helper 可接受 transaction client。
- fake pool 测试改为验证 executor 不再通过 pool 直接执行 transaction SQL，而是走 leased client。
- rollback 测试覆盖失败后 `ROLLBACK` 与 `release()`。

## 本地验证

```text
npm test -- src/domain/postgres-scoped-migration-executor.test.ts --reporter verbose: passed, 4 tests
npm run typecheck: passed
```

## 重要边界

- 这仍不是线上迁移。
- 不读取 `DATABASE_URL`。
- 不连接 Render 生产库。
- 不新增 CLI 执行入口。
- disposable database integration harness 仍只通过 `NNZ_POSTGRES_INTEGRATION_URL` opt-in。

## 下一步

1. 跑全量 `npm test` 与 `npm run build:demo`。
2. 有一次性 Postgres 测试库时，运行 repository + executor integration：

```text
NNZ_POSTGRES_INTEGRATION_URL=... npm test -- src/domain/postgres-scoped-soul-repository.integration.test.ts src/domain/postgres-scoped-migration-executor.integration.test.ts --reporter verbose
```

3. 导出真实 `StoreSnapshot` 样本并跑 sanitized dry-run report。
