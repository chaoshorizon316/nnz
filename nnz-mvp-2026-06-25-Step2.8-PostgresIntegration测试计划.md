# nnz-mvp 2026-06-25 Step 2.8：Postgres integration 测试计划

## 目标

Step 2.8 的目标是给 `PostgresScopedSoulRepository` 建立真实 Postgres 集成测试入口，验证 fake pool 无法证明的数据库行为。

本阶段仍不替换线上 demo runtime persistence：

- 不读取 `DATABASE_URL`。
- 不连接 Render 生产库。
- 不写迁移脚本。
- 不切换 demo-server。

## 测试入口

新增 opt-in 环境变量：

```text
NNZ_POSTGRES_INTEGRATION_URL
```

只有显式提供这个变量时，integration test 才会连接数据库运行。默认 `npm test` 仍会跳过真实 Postgres 测试，确保本地和 CI 不因缺数据库失败。

## 本阶段验证范围

集成测试至少覆盖：

- `ensurePostgresScopedSchema()` 可在真实 Postgres 上执行。
- JSONB 字段可写入并读回：
  - `kernel_json`
  - `memory_ids`
  - `old_value` / `new_value`
  - `metadata`
- 复合外键能防止跨 scope snapshot / memory / proposal 误关联。
- 删除 user 后，scope 内 persona / memory / soul / snapshot / node / conversation / session / credential 级联删除。
- `OpsAuditEvent` 作为后台全局表不会随 user 删除自动丢失。

## 安全规则

- 测试只允许使用 `NNZ_POSTGRES_INTEGRATION_URL`，禁止回退到 `DATABASE_URL` 或 `NNZ_POSTGRES_URL`。
- 测试使用唯一前缀 id，避免与人工数据冲突。
- 测试结束后尽量删除自己创建的 user。
- 文档不记录连接串。

## 验收标准

默认无数据库环境必须通过：

```text
npm run typecheck
npm test
npm run build:demo
git diff --check
```

有测试数据库时可额外运行：

```text
NNZ_POSTGRES_INTEGRATION_URL=... npm test -- src/domain/postgres-scoped-soul-repository.integration.test.ts
```

## 实施结果（2026-06-25）

已完成默认跳过的真实 Postgres integration test harness：

- 新增 `src/domain/postgres-scoped-soul-repository.integration.test.ts`。
- 测试只读取 `NNZ_POSTGRES_INTEGRATION_URL`，不会回退到 `DATABASE_URL` / `NNZ_POSTGRES_URL`。
- 默认 `npm test` 中该文件会 skip，不影响本地和 CI。
- 有测试库时可验证真实 Postgres 上的 schema 创建、JSONB round-trip、复合外键拒绝跨 scope snapshot / memory、跨 scope evidence / node 拒绝、user 删除后的级联删除，以及 OpsAudit 全局保留。

本阶段仍未替换 demo runtime 的 Postgres snapshot persistence；线上路径继续使用当前稳定的 `nnz_store_snapshots` JSONB 快照。

## 本地验证

```text
npm run typecheck: passed
npm test: passed, 13 test files / 87 tests, 1 integration file skipped
npm run build:demo: passed
git diff --check: passed
```

尚未执行：

```text
NNZ_POSTGRES_INTEGRATION_URL=... npm test -- src/domain/postgres-scoped-soul-repository.integration.test.ts
```

原因：本轮未提供一次性测试库连接串；为避免误连 Render / production database，未自动读取 `DATABASE_URL` 或其他环境变量。

## 产品与伦理边界

本阶段不新增用户前台功能，只增强数据可靠性验证。

符合产品红线：

- 不改变 Covenant 节奏。
- 不增加用户依赖。
- 不向用户暴露 repository / scope / proposal / evidence 等机制。
- 为未来数据主权、删除、导出和毕业流程打基础。
