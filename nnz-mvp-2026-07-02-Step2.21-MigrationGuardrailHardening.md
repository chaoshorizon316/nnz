# nnz-mvp 2026-07-02 Step 2.21 Migration Guardrail Hardening

## 结论

已按产品进程审计修复 `migration:execute` 和 `migration:smoke` 的两个安全缺口：生产别名误配防护、pool close failure 脱敏输出。

这不是新增 migration CLI，而是对现有受保护入口的安全补强。真实 snapshot readiness、真实 disposable DB smoke、Render role token smoke、demo runtime scoped-table adapter 仍是后续目标。

## 修复点

### P1：生产别名误连防护

新增共享 helper：

```text
nnz-mvp/src/tools/postgres-disposable-env-guard.ts
```

`migration:execute` 和 `migration:smoke` 现在都会检查：

- 必须显式使用 `NNZ_POSTGRES_INTEGRATION_URL`
- `NNZ_POSTGRES_INTEGRATION_URL` 必须非空
- `NNZ_POSTGRES_INTEGRATION_URL` 的值不能与 `DATABASE_URL` 相同
- `NNZ_POSTGRES_INTEGRATION_URL` 的值不能与 `NNZ_POSTGRES_URL` 相同

比较前会 trim。拒绝信息只打印 env key，不打印任何 URL。

### P2：pool close failure 脱敏

`migration:smoke` 的 `pool.end()` 已包裹固定脱敏输出，close 阶段失败不会泄露 raw database details。

同类风险也同步修到 `migration:execute`，避免 protected execution 在 close failure 时落到外层 raw error message。

## 代码变更

- 新增 `nnz-mvp/src/tools/postgres-disposable-env-guard.ts`
- 更新 `nnz-mvp/src/tools/postgres-scoped-migration-smoke-cli.ts`
- 更新 `nnz-mvp/src/tools/postgres-scoped-migration-smoke-cli.test.ts`
- 更新 `nnz-mvp/src/tools/postgres-scoped-migration-execute-cli.ts`
- 更新 `nnz-mvp/src/tools/postgres-scoped-migration-execute-cli.test.ts`

## 验证

```text
npm test -- src/tools/postgres-scoped-migration-smoke-cli.test.ts src/tools/postgres-scoped-migration-execute-cli.test.ts --reporter verbose
npm run typecheck
npm test
npm run build:demo
git diff --check
```

结果：

```text
targeted execute/smoke CLI tests: 15 tests passed
typecheck: passed
full test: 22 个测试文件、138 tests passed；2 个 integration 文件 skipped
build:demo: passed
git diff --check: passed
```

## 剩余目标

Step 2 仍剩 4 个未完成目标：

1. 用真实本地 snapshot 样本跑 `migration:readiness`。
2. 用一次性 Postgres 测试库跑 `migration:smoke`。
3. 验证 Render viewer/operator/admin role tokens。
4. 在 Step 2.20 / Step 2.21 guardrails 后实现真正的 demo runtime scoped-table adapter。
