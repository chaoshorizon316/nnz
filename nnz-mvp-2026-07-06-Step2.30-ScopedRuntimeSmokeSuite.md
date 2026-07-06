# nnz-mvp 2026-07-06 Step 2.30 Scoped Runtime Smoke Suite

## 目标

把目标 4 的 scoped runtime 实跑步骤合并成一个受保护命令。此前已经有 direct adapter smoke（`runtime:smoke`）和真实 HTTP surface smoke（`runtime:http-smoke`），但需要手动分两次执行。这一步新增 suite：拿到 disposable `NNZ_POSTGRES_SCOPED_RUNTIME_URL` 后，一次命令跑完 direct adapter、demo build、HTTP `/api/me/*` 链路。

## 已实现

- 新增 `nnz-mvp/src/tools/postgres-scoped-runtime-smoke-suite-cli.ts`。
- 新增 `nnz-mvp/src/tools/postgres-scoped-runtime-smoke-suite-cli.test.ts`。
- `nnz-mvp/package.json` 新增：

```json
"runtime:smoke-suite": "node --import tsx src/tools/postgres-scoped-runtime-smoke-suite-cli.ts"
```

命令：

```bash
npm run runtime:smoke-suite -- --database-url-env NNZ_POSTGRES_SCOPED_RUNTIME_URL --confirm RUN_POSTGRES_SCOPED_RUNTIME_SMOKE_SUITE
```

可选：

```bash
npm run runtime:smoke-suite -- --database-url-env NNZ_POSTGRES_SCOPED_RUNTIME_URL --confirm RUN_POSTGRES_SCOPED_RUNTIME_SMOKE_SUITE --skip-build
```

`--skip-build` 只应在 `dist-cjs/demo-server.js` 已确认来自当前源码时使用。

## 执行顺序

1. 运行 direct scoped runtime adapter smoke：
   `runtime:smoke -- --database-url-env NNZ_POSTGRES_SCOPED_RUNTIME_URL --confirm RUN_POSTGRES_SCOPED_RUNTIME_SMOKE`
2. 默认运行 `npm run build:demo`。
3. 运行真实 HTTP smoke：
   `runtime:http-smoke -- --database-url-env NNZ_POSTGRES_SCOPED_RUNTIME_URL --confirm RUN_POSTGRES_SCOPED_RUNTIME_HTTP_SMOKE`

suite 自己只接受 `RUN_POSTGRES_SCOPED_RUNTIME_SMOKE_SUITE`，内部再把安全确认转发给两个子命令。

## 安全边界

- 只允许 `--database-url-env NNZ_POSTGRES_SCOPED_RUNTIME_URL`。
- 必须显式传 `--confirm RUN_POSTGRES_SCOPED_RUNTIME_SMOKE_SUITE`。
- 拒绝 `DATABASE_URL` / `NNZ_POSTGRES_URL`。
- 拒绝 `NNZ_POSTGRES_SCOPED_RUNTIME_URL` 与 `DATABASE_URL` 或 `NNZ_POSTGRES_URL` 同值。
- stdout 只输出固定 stage：directRuntimeAdapterSmoke、demoBuild、httpApiSmoke。
- 任一 stage 失败时，只输出固定 stage 失败文案。
- 不拼接子命令 stdout/stderr，避免 raw DB error、server log、child process output 或 secret 被带出。
- 不打印 DB URL、token、email、password、memory text、chat content、credential hash、row payload 或 raw error details。
- 该入口是 protected developer smoke，不属于用户前台体验，不新增任何用户可见机制文案。

## 验证

```text
npm test -- src/tools/postgres-scoped-runtime-smoke-suite-cli.test.ts --reporter verbose: 10 tests passed
npm run runtime:smoke-suite -- --help: passed
npm run typecheck: passed
npm test: 28 个测试文件、175 tests passed；2 个 integration 文件 skipped
npm run build:demo: passed
git diff --check: passed
```

未实跑真实 disposable DB，因为当前环境未提供 `NNZ_POSTGRES_SCOPED_RUNTIME_URL`。下一步拿到一次性 scoped runtime DB 后，直接跑 `runtime:smoke-suite`。

## 剩余目标

Step 2 仍剩 4 个未完全收口目标：

1. 用真实本地 snapshot 样本跑 `migration:readiness`。
2. 用一次性 Postgres 测试库跑 `migration:smoke`。
3. 在 Render 验证 viewer/operator/admin role tokens。
4. 用 disposable `NNZ_POSTGRES_SCOPED_RUNTIME_URL` 实跑 `runtime:smoke-suite`。
