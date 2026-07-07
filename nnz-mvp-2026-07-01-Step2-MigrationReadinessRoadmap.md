# nnz-mvp 2026-07-01 Step 2 Migration Readiness Roadmap

## 当前结论

Step 2 的 scoped repository 与 snapshot migration 工具链已经完成到 Step 2.32。最新已推送提交是：

```text
28b61ff feat: add migration validation suite
```

当前本地新增 Step 2.32 Ops role token smoke CLI，尚待下一次合并 push。

截至 2026-07-06，链路还剩 **3 类外部实跑未完全收口**：真实本地 snapshot + 一次性 Postgres 的 `migration:validation-suite`、Render viewer/operator/admin 角色 token 的 `ops:role-smoke`、以及真实 scoped runtime DB 的 `runtime:smoke-suite`。受保护执行入口、readiness/smoke CLI、migration validation suite、runtime mode guardrail、migration guardrail hardening、scoped runtime adapter foundation、`/api/me/*` 用户端 InMemory adapter wiring、guarded scoped runtime Postgres adapter mode、scoped runtime smoke guard、scoped Ops cleanup/audit cutover、scoped Ops overview aggregation、用户 export/delete cutover、scoped runtime HTTP smoke CLI、合并执行的 scoped runtime smoke suite、以及 Ops role token smoke CLI 都已完成本地实现；真实 DB/Render 执行仍需要 disposable URL、snapshot 路径或 token env。

## 已完成基线

- Step 2.5-2.7：`PostgresScopedSoulRepository` 已覆盖 users/personas/memory/conversations/soul versions/snapshots/nodes/runtime sessions/proposals/credentials/ops audit。
- Step 2.8：真实 Postgres repository integration harness 已实现，默认 skip，只读取 `NNZ_POSTGRES_INTEGRATION_URL`。
- Step 2.9：snapshot -> scoped tables 离线迁移预检 planner 已实现。
- Step 2.10：`migration:plan` CLI 已实现，支持 `--json` 与 sanitized `--report`。
- Step 2.11：scoped migration row builder 已实现。
- Step 2.12：write-side migration executor core 已实现，需要显式 confirm。
- Step 2.13：executor disposable DB integration harness 已实现，默认 skip。
- Step 2.14：executor 已改为 checked-out client transaction，避免 `pg.Pool#query()` 多连接事务漂移。
- Step 2.15：`snapshot:export` CLI 已实现，只读取显式本地 JSON/SQLite 输入，stdout 只输出 counts。
- Step 2.16：`migration:plan -- --summary` 已实现，只输出聚合 counts/code/table/nextAction。
- Step 2.17：`migration:execute` protected CLI 已实现；默认 dry-run，执行模式只读取 `NNZ_POSTGRES_INTEGRATION_URL`，拒绝 `DATABASE_URL` / `NNZ_POSTGRES_URL`，需要显式 confirm。
- Step 2.18：`migration:readiness` CLI 已实现；从显式本地 JSON/SQLite 一次生成 raw snapshot、sanitized report、sanitized summary，不读取任何 DB env。
- Step 2.19：`migration:smoke` CLI 已实现；用 disposable DB 验证 executor 幂等、repository 读回、scope 隔离、cascade delete 和 fixture cleanup。
- Step 2.20：runtime persistence mode guardrail 已实现；`NNZ_RUNTIME_PERSISTENCE_MODE=snapshot` 保持默认 snapshot 路径，`scoped` 模式需要 `NNZ_POSTGRES_SCOPED_RUNTIME_URL` 且在 adapter 完成前 fail-fast；`/healthz` 和 Ops overview 只暴露 env key / boolean 诊断。
- Step 2.21：migration guardrail hardening 已实现；`migration:execute` 与 `migration:smoke` 会拒绝 `NNZ_POSTGRES_INTEGRATION_URL` 与 `DATABASE_URL` / `NNZ_POSTGRES_URL` 值相同的生产别名误配，并对 pool close failure 使用固定脱敏输出。
- Step 2.22：scoped runtime adapter foundation 已实现；新增 `ScopedRuntimeAdapter`，同时支持 InMemory 与 Postgres scoped repository 后端，覆盖 auth credential、persona、conversation、runtime context、Covenant NODE/SEALED/GRADUATED 的切换接口。
- Step 2.23：`/api/me/*` 用户端 auth/persona/chat/Covenant flow 已接入 InMemory `ScopedRuntimeAdapter`；默认 snapshot/Postgres JSONB 持久化语义不变，并通过本地 API smoke 验证注册、创建、聊天、历史、封存、节点重启和完成节点。
- Step 2.24：`NNZ_RUNTIME_PERSISTENCE_MODE=scoped` 已接到 Postgres scoped runtime persistence helper；启动时只读取 `NNZ_POSTGRES_SCOPED_RUNTIME_URL`、确保 scoped schema、把 `/api/me/*` runtime adapter 指向 Postgres scoped tables；缺专用 URL 仍 fail-fast，默认 snapshot 路径不变。
- Step 2.25：`NNZ_POSTGRES_SCOPED_RUNTIME_URL` 已加生产别名误配防护；新增 `runtime:smoke`，只允许专用 scoped runtime URL + 显式 confirm，并用 scoped runtime adapter 验证 credential/persona/runtime context/Covenant/cross-scope/cascade/cleanup，输出全脱敏。
- Step 2.26：scoped mode 下 Ops cleanup/audit 第一段已切到 scoped Postgres；`/api/ops/cleanup-test-users` dry-run/confirm 与 audit write/query 可走 `nnz_*` scoped tables；full Ops overview user/persona maturity 与用户 export/delete 仍待后续。
- Step 2.27：scoped mode 下 `/api/ops/overview` users/personas/maturity aggregation 已切到 scoped Postgres；后台内部复用现有 maturity 算法，不返回 memory/chat/hash 正文。
- Step 2.28：用户数据 export/delete 已接入 `ScopedRuntimeAdapter`；`GET /api/me/export` 导出当前登录用户自己的完整数据档案但不含 credential hash 或后台 OpsAudit，`POST /api/me/delete` 需要 `DELETE_MY_DATA` 确认并只删除当前登录用户；scoped Postgres mode 下通过 `nnz_users` FK cascade 清理 scoped tables。
- Step 2.29：`runtime:http-smoke` CLI 已实现；用 disposable `NNZ_POSTGRES_SCOPED_RUNTIME_URL` 启动真实 `dist-cjs/demo-server.js` scoped mode，清空 child `NNZ_LLM_*`，验证 `/healthz` scoped 诊断以及 `/api/me/*` register/persona/chat/history/Covenant/export/delete HTTP 链路；拒绝 `DATABASE_URL` / `NNZ_POSTGRES_URL` 与生产别名同值，输出脱敏。
- Step 2.30：`runtime:smoke-suite` CLI 已实现；一次运行 direct `runtime:smoke`、`build:demo`、HTTP `runtime:http-smoke`，统一使用 `NNZ_POSTGRES_SCOPED_RUNTIME_URL` 与 suite confirm，失败时只输出固定 stage 与脱敏说明。
- Step 2.31：`migration:validation-suite` CLI 已实现；一次运行 offline `migration:readiness` 与 disposable `migration:smoke`，readiness 干净后才连接 `NNZ_POSTGRES_INTEGRATION_URL`，失败时不输出 raw snapshot、child command output 或 raw details。
- Step 2.32：`ops:role-smoke` CLI 已实现；默认非破坏性地验证 missing/invalid token、viewer read-only、operator dry-run、admin dry-run 与 admin delete confirmation boundary，确认删除 smoke 需要额外 `--include-delete --delete-confirm RUN_OPS_ROLE_TOKEN_DELETE_SMOKE`。

## 剩余目标状态

| # | 目标 | 当前状态 | 完成标准 |
|---|---|---|---|
| 1 | 真实本地 snapshot dry-run | 本地 readiness CLI 已实现；Step 2.31 已把 readiness 接入 `migration:validation-suite`；仍需要可用的本地 SQLite 或 snapshot JSON | 运行 `migration:validation-suite` 生成 raw snapshot、sanitized report、sanitized summary，审阅 blocking errors、warnings、rowBuild counts |
| 2 | 一次性 Postgres repository/executor integration run | 本地 smoke CLI 与 guardrails 已实现；Step 2.31 已把 smoke 接入 `migration:validation-suite`；仍需要 `NNZ_POSTGRES_INTEGRATION_URL` 指向一次性库，不能等于线上 `DATABASE_URL` / `NNZ_POSTGRES_URL` | `migration:validation-suite` 在 readiness 通过后继续跑 disposable DB smoke，覆盖 executor 幂等、repository 读回、scope 隔离、audit row、级联删除和 cleanup |
| 3 | 云端角色 token smoke | `ops:role-smoke` 已实现；仍需要 Render 配置 viewer/operator/admin token，并在本地 shell 只注入对应 env 值 | 验证 viewer 只读、operator 可 dry-run、admin 可 confirm cleanup；不记录 token 明文、响应 payload、用户内容或 cleanup receipt |
| 4 | demo runtime scoped-table adapter | Step 2.20/2.21 已加 runtime 与 migration guardrails；Step 2.22 已建立 adapter foundation；Step 2.23 已把 `/api/me/*` auth/persona/chat/Covenant flow 接到 InMemory adapter；Step 2.24 已接 guarded scoped Postgres runtime mode；Step 2.25 已补 `runtime:smoke`；Step 2.26 已补 scoped Ops cleanup/audit；Step 2.27 已补 scoped Ops overview；Step 2.28 已补用户 export/delete；Step 2.29 已补真实 HTTP surface smoke CLI；Step 2.30 已把 direct + HTTP runtime smokes 合并为 `runtime:smoke-suite`；真实 scoped DB smoke 仍待实跑 | `/api/me/*`、chat、ops、cleanup、export/delete 都走 scoped tables，仍保持 `userId + personaId` 强隔离 |

## 推荐推进顺序

1. 先做目标 1+2：拿一个真实本地 snapshot 样本和一次性 Postgres 测试库跑 `migration:validation-suite`。suite 会先离线生成 raw snapshot、sanitized report、sanitized summary，readiness 干净后才连接 disposable DB 跑 migration smoke。
2. 如 readiness 输出 blocking errors，先只审阅 sanitized report，不连接数据库。
3. 做目标 3：当 Render 角色 token 配好后，运行 `ops:role-smoke` 做 viewer/operator/admin cloud smoke；默认先不跑 confirmed delete。
4. 最后继续目标 4：用 disposable `NNZ_POSTGRES_SCOPED_RUNTIME_URL` 跑 `runtime:smoke-suite`，一次覆盖 adapter 直连与真实 HTTP 注册、创建、聊天、Covenant、导出和删除。

## 安全边界

- 不使用 `DATABASE_URL` 做 migration test 或 migration execution。
- 所有 migration integration 只读取 `NNZ_POSTGRES_INTEGRATION_URL`。
- `snapshot:export` 输出是完整敏感 snapshot，不能提交，不能贴到聊天或文档。
- `migration:readiness` 也会输出 raw snapshot；raw snapshot 只能留在本地，summary/report 才用于审阅。
- `migration:plan -- --summary` 可用于口头同步；`--report` 可用于审阅，但仍只保留 sanitized 结果。
- `migration:execute` 默认是 dry-run；真正执行必须同时传 `--execute`、`--database-url-env NNZ_POSTGRES_INTEGRATION_URL`、`--confirm EXECUTE_POSTGRES_SCOPED_MIGRATION`。
- `migration:smoke` 真正连接数据库前必须传 `--database-url-env NNZ_POSTGRES_INTEGRATION_URL` 和 `--confirm RUN_POSTGRES_SCOPED_MIGRATION_SMOKE`。
- `migration:validation-suite` 是目标 1+2 的推荐入口；真正连接数据库前必须传 `--database-url-env NNZ_POSTGRES_INTEGRATION_URL` 和 `--confirm RUN_POSTGRES_SCOPED_MIGRATION_VALIDATION_SUITE`；它先跑 offline readiness，readiness exit 0 后才跑 disposable smoke。
- `NNZ_POSTGRES_INTEGRATION_URL` 不能与 `DATABASE_URL` 或 `NNZ_POSTGRES_URL` 的值相同；两个受保护入口都会拒绝这种生产别名误配，且错误信息不打印 URL。
- `NNZ_RUNTIME_PERSISTENCE_MODE=scoped` 不使用 `DATABASE_URL` / `NNZ_POSTGRES_URL`，只允许通过 `NNZ_POSTGRES_SCOPED_RUNTIME_URL` 表达 scoped runtime 连接；缺专用 URL 仍 fail-fast，且诊断只暴露 env key / boolean。
- `runtime:smoke` 真正连接数据库前必须传 `--database-url-env NNZ_POSTGRES_SCOPED_RUNTIME_URL` 和 `--confirm RUN_POSTGRES_SCOPED_RUNTIME_SMOKE`；`NNZ_POSTGRES_SCOPED_RUNTIME_URL` 不能与 `DATABASE_URL` 或 `NNZ_POSTGRES_URL` 的值相同。
- `runtime:http-smoke` 真正连接数据库前必须先 `npm run build:demo`，再传 `--database-url-env NNZ_POSTGRES_SCOPED_RUNTIME_URL` 和 `--confirm RUN_POSTGRES_SCOPED_RUNTIME_HTTP_SMOKE`；它会启动真实 demo server，但 stdout/stderr 不输出 DB URL、token、email/password、memory/chat、credential hash、row payload、server log 或 raw error details。
- `runtime:smoke-suite` 是目标 4 的推荐入口；真正连接数据库前必须传 `--database-url-env NNZ_POSTGRES_SCOPED_RUNTIME_URL` 和 `--confirm RUN_POSTGRES_SCOPED_RUNTIME_SMOKE_SUITE`；它串行运行 direct smoke、`build:demo` 和 HTTP smoke，失败时不打印 child process output 或 raw details。
- `ops:role-smoke` 是目标 3 的推荐入口；默认只做非破坏性边界验证，必须传 `--base-url` 与 `--confirm RUN_OPS_ROLE_TOKEN_SMOKE`，并从本地 shell 读取 `NNZ_OPS_VIEWER_TOKEN` / `NNZ_OPS_OPERATOR_TOKEN` / `NNZ_OPS_ADMIN_TOKEN`。确认删除 smoke 还必须额外传 `--include-delete --delete-confirm RUN_OPS_ROLE_TOKEN_DELETE_SMOKE`。stdout/stderr 不打印 token 值、response payload、用户内容、cleanup receipt、server log 或 raw network details。
- 任何执行入口都必须保留 `userId + personaId` 作用域边界，不能引入 persona-only 查询。
- 用户端不可暴露 `SoulVersion`、`SoulSnapshot`、`scope`、`evidence`、`migration` 等后台机制。

## 当前可继续做的本地工作

- 用真实本地 snapshot/SQLite 与 disposable `NNZ_POSTGRES_INTEGRATION_URL` 跑 `migration:validation-suite`。
- 用 Render base URL 与本地 role token env 跑 `ops:role-smoke`。
- 用 disposable `NNZ_POSTGRES_SCOPED_RUNTIME_URL` 跑 `runtime:smoke-suite`；默认仍保持 snapshot persistence。

## 当前需要用户或外部环境提供的东西

- 一个本地 SQLite persistence 文件，或一个本地 `StoreSnapshot` JSON 文件路径。
- 一个一次性 Postgres 测试库 URL，用 `NNZ_POSTGRES_INTEGRATION_URL` 注入。
- Render 中是否已配置 `NNZ_OPS_VIEWER_TOKEN` / `NNZ_OPS_OPERATOR_TOKEN` / `NNZ_OPS_ADMIN_TOKEN` 的确认，以及本地 shell 中同名 env 值。
