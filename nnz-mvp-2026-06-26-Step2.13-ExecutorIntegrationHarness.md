# nnz-mvp 2026-06-26 Step 2.13：executor disposable DB integration harness

## 目标

Step 2.13 的目标是在 Step 2.12 write-side executor core 之后，补一个 opt-in 的真实 Postgres 集成测试脚手架。

本阶段仍不执行线上迁移：

- 不读取 `DATABASE_URL`。
- 不读取 `NNZ_POSTGRES_URL`。
- 不连接 Render 生产库。
- 不提供 CLI 执行入口。
- 不切换 demo runtime persistence。

## 范围

新增测试：

```text
src/domain/postgres-scoped-migration-executor.integration.test.ts
```

执行边界：

- 只读取 `NNZ_POSTGRES_INTEGRATION_URL`。
- 默认 `npm test` 中跳过。
- 有一次性 Postgres 测试库连接串时才会连接。
- 测试构造双 user / 双 persona 的 `StoreSnapshot`。
- 调用 `executePostgresScopedMigration(...)` 两次，验证 executor 幂等。
- 通过 `PostgresScopedSoulRepository` 读回 memory、conversation、proposal、runtime session、credential。
- 验证 cross-scope node conversation 被拒绝。
- 删除测试 user 后验证 scoped tables 级联清理。
- OpsAudit 作为后台全局表单独清理。

## 实施结果（2026-06-26）

已完成 executor integration harness：

- 新增 `src/domain/postgres-scoped-migration-executor.integration.test.ts`。
- 覆盖 executor 真实 SQL 写入、JSONB round-trip、repository 读回、scope 隔离、级联删除和幂等重跑。
- 默认无 `NNZ_POSTGRES_INTEGRATION_URL` 时 skip，避免误连生产。

## 本地验证

```text
npm run typecheck: passed
npm test -- src/domain/postgres-scoped-migration-executor.test.ts src/domain/postgres-scoped-migration-executor.integration.test.ts --reporter verbose: passed, 4 tests + 1 skipped integration test
npm test: passed, 17 test files / 104 tests, 2 integration files skipped
npm run build:demo: passed
```

尚未执行：

```text
NNZ_POSTGRES_INTEGRATION_URL=... npm test -- src/domain/postgres-scoped-soul-repository.integration.test.ts src/domain/postgres-scoped-migration-executor.integration.test.ts --reporter verbose
```

原因：本轮未提供一次性测试库连接串；为避免误连 Render / production database，未自动读取 `DATABASE_URL` 或其他生产环境变量。

## 下一步

1. 准备 disposable Postgres database。
2. 设置 `NNZ_POSTGRES_INTEGRATION_URL`，同时跑 Step 2.8 repository integration 和 Step 2.13 executor integration。
3. 导出真实 `StoreSnapshot` 样本，先跑 `npm run migration:plan -- --report <report-json-path> <snapshot-json-path>`。
4. 审阅 sanitized report 的 errors / warnings / rowBuild counts。
5. 上述验证通过后，再设计受保护的执行入口。

## 产品与伦理边界

本阶段是后端迁移可靠性工作，不新增用户前台功能。

符合产品红线：

- 不改变 Covenant 节奏。
- 不增加用户依赖。
- 不向用户暴露 repository / scope / snapshot / migration 等机制。
- 继续为未来数据主权、删除、导出和毕业流程打基础。
