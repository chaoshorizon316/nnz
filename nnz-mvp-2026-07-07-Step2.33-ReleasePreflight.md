# 2026-07-07 Step 2.33 Release Preflight CLI

## 目标

把剩余三类上线前外部实跑的输入缺口收敛成一个本地可重复检查的命令：

- `migration:validation-suite` 需要真实本地 snapshot/SQLite 和 `NNZ_POSTGRES_INTEGRATION_URL`。
- `ops:role-smoke` 需要 Render base URL 与 viewer/operator/admin role token env。
- `runtime:smoke-suite` 需要 `NNZ_POSTGRES_SCOPED_RUNTIME_URL`。

这一步不替代真实 smoke，也不接触用户前台体验。它只让“现在还缺什么”变成稳定、脱敏、可复查的输出。

## 实现

新增：

```text
nnz-mvp/src/tools/release-preflight-cli.ts
nnz-mvp/src/tools/release-preflight-cli.test.ts
```

`package.json` 新增：

```text
npm run release:preflight
```

默认命令：

```bash
npm run release:preflight -- --snapshot <sqlite-or-snapshot-json-path>
npm run release:preflight -- --snapshot-env NNZ_MIGRATION_SNAPSHOT_PATH
```

默认检查：

- `--snapshot` 或 `NNZ_MIGRATION_SNAPSHOT_PATH` 是否存在。
- `NNZ_POSTGRES_INTEGRATION_URL` 是否设置，且不等于 `DATABASE_URL` / `NNZ_POSTGRES_URL`。
- `NNZ_OPS_VIEWER_TOKEN` / `NNZ_OPS_OPERATOR_TOKEN` / `NNZ_OPS_ADMIN_TOKEN` 是否设置。
- `NNZ_POSTGRES_SCOPED_RUNTIME_URL` 是否设置，且不等于 `DATABASE_URL` / `NNZ_POSTGRES_URL`。
- Ops base URL 是否是 HTTP/HTTPS URL。

支持覆盖：

```bash
npm run release:preflight -- \
  --snapshot-env NNZ_MIGRATION_SNAPSHOT_PATH \
  --migration-database-url-env NNZ_POSTGRES_INTEGRATION_URL \
  --runtime-database-url-env NNZ_POSTGRES_SCOPED_RUNTIME_URL \
  --viewer-token-env NNZ_OPS_VIEWER_TOKEN \
  --operator-token-env NNZ_OPS_OPERATOR_TOKEN \
  --admin-token-env NNZ_OPS_ADMIN_TOKEN \
  --ops-base-url https://nnz-kego.onrender.com
```

## 安全边界

- 不读取 snapshot 内容，只检查文件存在性。
- 不连接数据库。
- 不发送 HTTP/network 请求。
- stdout 只输出 ready/blocked、env key 名称和固定命令模板。
- 不打印 snapshot 路径、数据库 URL、token 值、用户内容、cleanup receipt、server log 或 raw network details。
- disposable DB env 与生产别名同值时只打印冲突 env key，不打印 URL。

## 当前环境结果

当前本地环境运行 `npm run release:preflight` 会返回 blocked，符合预期：

- 没有配置 `NNZ_MIGRATION_SNAPSHOT_PATH`，也没有传 `--snapshot`。
- 没有设置 `NNZ_POSTGRES_INTEGRATION_URL`。
- 没有设置 `NNZ_OPS_VIEWER_TOKEN` / `NNZ_OPS_OPERATOR_TOKEN` / `NNZ_OPS_ADMIN_TOKEN`。
- 没有设置 `NNZ_POSTGRES_SCOPED_RUNTIME_URL`。

该命令没有触网、没有连接数据库、没有读取 snapshot。

## 验证

本地已通过：

```text
npm run typecheck
npm test -- src/tools/release-preflight-cli.test.ts --reporter verbose
npm run release:preflight -- --help
npm run release:preflight
npm test
npm run build:demo
git diff --check
```

全量测试数：31 个测试文件 / 196 tests passed，另有 2 个 opt-in Postgres integration 文件 skipped。

## 后续

下一步仍是外部实跑，而不是继续造工具：

1. 注入 snapshot/SQLite 路径、`NNZ_POSTGRES_INTEGRATION_URL`、role token env、`NNZ_POSTGRES_SCOPED_RUNTIME_URL` 后先跑 `release:preflight`。
2. preflight ready 后跑 `migration:validation-suite`。
3. 跑默认非破坏性 `ops:role-smoke`。
4. 跑 `runtime:smoke-suite`。
