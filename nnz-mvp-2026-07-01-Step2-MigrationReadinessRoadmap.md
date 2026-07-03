# nnz-mvp 2026-07-01 Step 2 Migration Readiness Roadmap

## 当前结论

Step 2 的 scoped repository 与 snapshot migration 工具链已经完成到 Step 2.24。最新已推送提交是：

```text
a2a7c30 feat: add scoped runtime adapter and wire api me flow
```

截至 2026-07-03，迁移链路还剩 **4 个目标未完全收口**：真实本地 snapshot readiness、一次性 Postgres smoke、Render 角色 token smoke、以及真正的 demo runtime scoped-table adapter 实库验收与后续 Ops/export/delete 收口。受保护执行入口、readiness/smoke CLI、runtime mode guardrail、migration guardrail hardening、scoped runtime adapter foundation、`/api/me/*` 用户端 InMemory adapter wiring，以及 guarded scoped runtime Postgres adapter mode 都已完成本地实现。

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

## 剩余目标状态

| # | 目标 | 当前状态 | 完成标准 |
|---|---|---|---|
| 1 | 真实本地 snapshot dry-run | 本地 readiness CLI 已实现；仍需要可用的本地 SQLite 或 snapshot JSON | 运行 `migration:readiness` 生成 raw snapshot、sanitized report、sanitized summary，审阅 blocking errors、warnings、rowBuild counts |
| 2 | 一次性 Postgres repository/executor integration run | 本地 smoke CLI 与 guardrails 已实现；仍需要 `NNZ_POSTGRES_INTEGRATION_URL` 指向一次性库，不能等于线上 `DATABASE_URL` / `NNZ_POSTGRES_URL` | `migration:smoke` 在 disposable DB 上通过，覆盖 executor 幂等、repository 读回、scope 隔离、audit row、级联删除和 cleanup |
| 3 | 云端角色 token smoke | 需要 Render 配置 viewer/operator/admin token 或用户提供操作窗口 | 验证 viewer 只读、operator 可 dry-run、admin 可 confirm cleanup；不记录 token 明文 |
| 4 | demo runtime scoped-table adapter | Step 2.20/2.21 已加 runtime 与 migration guardrails；Step 2.22 已建立 adapter foundation；Step 2.23 已把 `/api/me/*` auth/persona/chat/Covenant flow 接到 InMemory adapter；Step 2.24 已接 guarded scoped Postgres runtime mode；真实 scoped DB smoke、Ops/cleanup/export/delete 后续仍待切换 | `/api/me/*`、chat、ops、cleanup、export/delete 都走 scoped tables，仍保持 `userId + personaId` 强隔离 |

## 推荐推进顺序

1. 先做目标 1：拿一个真实本地 snapshot 样本跑 `migration:readiness`。这个步骤只读本地文件，不连数据库，最适合先发现数据形状问题。
2. 再做目标 2：用一次性 Postgres 测试库实跑 `migration:smoke`。这里必须使用 disposable DB，不能使用 Render 线上库。
3. 做目标 3：当 Render 角色 token 配好后，补 viewer/operator/admin cloud smoke。
4. 最后继续目标 4：用 disposable `NNZ_POSTGRES_SCOPED_RUNTIME_URL` 跑 `/api/me/*` scoped Postgres smoke，再扩展 Ops/cleanup/export/delete。

## 安全边界

- 不使用 `DATABASE_URL` 做 migration test 或 migration execution。
- 所有 migration integration 只读取 `NNZ_POSTGRES_INTEGRATION_URL`。
- `snapshot:export` 输出是完整敏感 snapshot，不能提交，不能贴到聊天或文档。
- `migration:readiness` 也会输出 raw snapshot；raw snapshot 只能留在本地，summary/report 才用于审阅。
- `migration:plan -- --summary` 可用于口头同步；`--report` 可用于审阅，但仍只保留 sanitized 结果。
- `migration:execute` 默认是 dry-run；真正执行必须同时传 `--execute`、`--database-url-env NNZ_POSTGRES_INTEGRATION_URL`、`--confirm EXECUTE_POSTGRES_SCOPED_MIGRATION`。
- `migration:smoke` 真正连接数据库前必须传 `--database-url-env NNZ_POSTGRES_INTEGRATION_URL` 和 `--confirm RUN_POSTGRES_SCOPED_MIGRATION_SMOKE`。
- `NNZ_POSTGRES_INTEGRATION_URL` 不能与 `DATABASE_URL` 或 `NNZ_POSTGRES_URL` 的值相同；两个受保护入口都会拒绝这种生产别名误配，且错误信息不打印 URL。
- `NNZ_RUNTIME_PERSISTENCE_MODE=scoped` 不使用 `DATABASE_URL` / `NNZ_POSTGRES_URL`，只允许通过 `NNZ_POSTGRES_SCOPED_RUNTIME_URL` 表达 scoped runtime 连接；缺专用 URL 仍 fail-fast，且诊断只暴露 env key / boolean。
- 任何执行入口都必须保留 `userId + personaId` 作用域边界，不能引入 persona-only 查询。
- 用户端不可暴露 `SoulVersion`、`SoulSnapshot`、`scope`、`evidence`、`migration` 等后台机制。

## 当前可继续做的本地工作

- 用 disposable `NNZ_POSTGRES_SCOPED_RUNTIME_URL` 跑 `/api/me/*` scoped Postgres smoke；默认仍保持 snapshot persistence。

## 当前需要用户或外部环境提供的东西

- 一个本地 SQLite persistence 文件，或一个本地 `StoreSnapshot` JSON 文件路径。
- 一个一次性 Postgres 测试库 URL，用 `NNZ_POSTGRES_INTEGRATION_URL` 注入。
- Render 中是否已配置 `NNZ_OPS_VIEWER_TOKEN` / `NNZ_OPS_OPERATOR_TOKEN` / `NNZ_OPS_ADMIN_TOKEN` 的确认，以及可操作的 smoke 窗口。
