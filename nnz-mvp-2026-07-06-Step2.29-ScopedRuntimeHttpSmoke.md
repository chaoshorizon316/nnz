# nnz-mvp 2026-07-06 Step 2.29 Scoped Runtime HTTP Smoke

## 目标

补齐 scoped runtime 的真实 HTTP surface smoke。此前 `runtime:smoke` 已能直连 `ScopedRuntimeAdapter` 验证 disposable scoped Postgres runtime；这一步新增受保护 CLI，从真实 `dist-cjs/demo-server.js` 启动 scoped mode，并通过 `/api/me/*` HTTP 链路验证注册、创建、聊天、Covenant、导出和删除。

## 已实现

- 新增 `nnz-mvp/src/tools/postgres-scoped-runtime-http-smoke-cli.ts`。
- 新增 `nnz-mvp/src/tools/postgres-scoped-runtime-http-smoke-cli.test.ts`。
- `nnz-mvp/package.json` 新增：

```json
"runtime:http-smoke": "node --import tsx src/tools/postgres-scoped-runtime-http-smoke-cli.ts"
```

命令：

```bash
npm run build:demo
npm run runtime:http-smoke -- --database-url-env NNZ_POSTGRES_SCOPED_RUNTIME_URL --confirm RUN_POSTGRES_SCOPED_RUNTIME_HTTP_SMOKE
```

## 覆盖链路

CLI 会启动真实 demo server：

- `NNZ_RUNTIME_PERSISTENCE_MODE=scoped`
- `NNZ_POSTGRES_SCOPED_RUNTIME_URL=<disposable scoped runtime DB>`
- `HOST=127.0.0.1`
- `PORT=3147`
- 清空 `DATABASE_URL`、`NNZ_POSTGRES_URL`、`NNZ_DB_PATH`
- 清空 `NNZ_LLM_API_KEY`、`NNZ_LLM_BASE_URL`、`NNZ_LLM_MODEL`，避免 smoke 过程顺手调用外部 LLM provider

然后验证：

- `/healthz` 返回 scoped Postgres runtime 诊断。
- `/api/register` 可注册 fixture user 并拿到 token。
- `/api/me/persona` 创建当前用户自己的 persona。
- `/api/me/chat` 与 `/api/me/chat-history` 可写入并读回当前用户自己的对话。
- `/api/me/seal`、`/api/me/activate-node`、`/api/me/complete-node`、`/api/me/graduate` 通过真实 HTTP 执行 Covenant 流转。
- `/api/me/export` 包含当前 fixture 的 memory/chat，但不含 `passwordHash` 或 raw password。
- `/api/me/delete` 删除当前登录用户，随后 `/api/me/export` 返回 404。
- finally 中若 token 仍存在，会再次尝试 `/api/me/delete` 清理 fixture。

## 安全边界

- 只允许 `--database-url-env NNZ_POSTGRES_SCOPED_RUNTIME_URL`。
- 必须显式传 `--confirm RUN_POSTGRES_SCOPED_RUNTIME_HTTP_SMOKE`。
- 拒绝 `DATABASE_URL` / `NNZ_POSTGRES_URL`。
- 拒绝 `NNZ_POSTGRES_SCOPED_RUNTIME_URL` 与 `DATABASE_URL` 或 `NNZ_POSTGRES_URL` 同值。
- stdout 只输出 fixture user count 与固定 check 名称。
- 失败输出只含固定失败文案、HTTP status / error code。
- 不打印 DB URL、token、email、password、memory text、chat content、credential hash、row payload、server log 或 raw error details。
- 该入口是 protected developer smoke，不属于用户前台体验，不新增任何用户可见机制文案。

## 验证

```text
npm test -- src/tools/postgres-scoped-runtime-http-smoke-cli.test.ts --reporter verbose: 8 tests passed
npm run runtime:http-smoke -- --help: passed
npm run typecheck: passed
npm test: 27 个测试文件、165 tests passed；2 个 integration 文件 skipped
npm run build:demo: passed
git diff --check: passed
```

未实跑真实 disposable DB，因为当前环境未提供 `NNZ_POSTGRES_SCOPED_RUNTIME_URL`。下一步拿到一次性 scoped runtime DB 后，先跑 `runtime:smoke`，再跑 `runtime:http-smoke`。

## 下一步

Step 2 仍剩 4 个未完全收口目标：

1. 用真实本地 snapshot 样本跑 `migration:readiness`。
2. 用一次性 Postgres 测试库跑 `migration:smoke`。
3. 在 Render 验证 viewer/operator/admin role tokens。
4. 用 disposable `NNZ_POSTGRES_SCOPED_RUNTIME_URL` 实跑 `runtime:smoke` 与 `runtime:http-smoke`。
