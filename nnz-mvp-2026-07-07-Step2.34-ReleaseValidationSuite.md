# 2026-07-07 Step 2.34 Release Validation Suite CLI

## 目标

把剩余上线前外部验证从三条手工命令收敛为一个受保护总入口：

1. `release:preflight`
2. `migration:validation-suite`
3. 默认非破坏性 `ops:role-smoke`
4. `runtime:smoke-suite`

这一步的目的不是新增用户功能，而是减少上线前验证的操作分叉和 push 等待点。

## 实现

新增：

```text
nnz-mvp/src/tools/release-validation-suite-cli.ts
nnz-mvp/src/tools/release-validation-suite-cli.test.ts
```

`package.json` 新增：

```text
npm run release:validation-suite
```

命令：

```bash
npm run release:validation-suite -- \
  --from-json <snapshot-or-wrapper-json-path> \
  --snapshot-out <raw-snapshot-json-path> \
  --report-out <sanitized-report-json-path> \
  --summary-out <sanitized-summary-json-path> \
  --confirm RUN_NNZ_RELEASE_VALIDATION_SUITE
```

或：

```bash
npm run release:validation-suite -- \
  --from-sqlite <sqlite-db-path> \
  --snapshot-out <raw-snapshot-json-path> \
  --report-out <sanitized-report-json-path> \
  --summary-out <sanitized-summary-json-path> \
  --confirm RUN_NNZ_RELEASE_VALIDATION_SUITE
```

可选：

```text
--force
--ops-base-url <https://...>
--host <host>
--port <port>
--server-entry <dist-cjs/demo-server.js>
--timeout-ms <ms>
--skip-build
```

## Stage 顺序

1. `release:preflight`
   - 检查 snapshot/SQLite、`NNZ_POSTGRES_INTEGRATION_URL`、Ops role token env、`NNZ_POSTGRES_SCOPED_RUNTIME_URL` 是否具备。
2. `migration:validation-suite`
   - 先 offline readiness。
   - readiness 干净后才跑 disposable Postgres migration smoke。
3. `ops:role-smoke`
   - 默认非破坏性。
   - 不传 `--include-delete`，因此不会执行 confirmed cleanup deletion。
4. `runtime:smoke-suite`
   - 串 direct scoped runtime smoke、`build:demo`、HTTP `/api/me/*` smoke。

## 安全边界

- 必须传 `--confirm RUN_NNZ_RELEASE_VALIDATION_SUITE`；否则不跑任何 stage。
- 不使用 `DATABASE_URL` / `NNZ_POSTGRES_URL` 做 disposable validation；底层 stage 继续强制专用 env。
- 失败时只输出固定 stage 名称，不拼接子命令 stdout/stderr。
- 不打印数据库 URL、token 值、snapshot 内容、用户内容、cleanup receipt、child command output、server log 或 raw error details。
- 默认不跑 confirmed Ops cleanup deletion。
- 该 CLI 是 admin/developer release validation，不属于用户前台功能，不引入用户可见机制文案。

## 当前环境结果

当前本地运行带确认的 suite 会停在 `release preflight`，符合预期：

```bash
npm run release:validation-suite -- --from-json missing-snapshot.json --snapshot-out raw.json --report-out report.json --summary-out summary.json --confirm RUN_NNZ_RELEASE_VALIDATION_SUITE
```

原因是当前没有真实 snapshot/SQLite 输入，也没有 disposable DB URL 和 role token env。命令未触发 DB/network 子阶段。

## 验证

本地已通过：

```text
npm run typecheck
npm test -- src/tools/release-validation-suite-cli.test.ts --reporter verbose
npm run release:validation-suite -- --help
npm run release:validation-suite -- --from-json missing-snapshot.json --snapshot-out raw.json --report-out report.json --summary-out summary.json --confirm RUN_NNZ_RELEASE_VALIDATION_SUITE
npm test
npm run build:demo
git diff --check
```

全量测试数：32 个测试文件 / 204 tests passed，另有 2 个 opt-in Postgres integration 文件 skipped。

## 后续

下一步只剩外部实跑：

1. 注入真实 snapshot/SQLite、`NNZ_POSTGRES_INTEGRATION_URL`、Render role token env、`NNZ_POSTGRES_SCOPED_RUNTIME_URL`。
2. 跑 `release:validation-suite`。
3. 若某个 stage 失败，使用对应单项命令做 focused diagnosis，修复后回到总 suite。
