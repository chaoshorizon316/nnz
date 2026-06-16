# nnz-mvp 2026-06-16：Soul Ops 云端启用记录

## 目标

本次工作把 2026-06-11 已完成的独立 `/ops` Soul Ops 后台，从本地验证推进到 Render 云端可用状态。

核心目标：

- 在 Render Web Service `nnz` 上配置 `NNZ_OPS_TOKEN`。
- 触发重新部署，让云端 `/ops` 从“未启用”切换为“受 token 保护”。
- 验证 `/api/ops/overview` 权限边界。
- 验证 `/api/ops/cleanup-test-users` 的 dry-run 清理计划，不执行真实删除。
- 将结果沉淀到知识库，便于其他 AI 继续接手。

重要安全约束：

- 本文档不记录 `NNZ_OPS_TOKEN` 明文。
- 不把 token 写入 GitHub、README、handoff 或任何代码文件。
- 后续如需轮换 token，应在 Render 环境变量中替换，并重新部署。

## 云端服务信息

```text
GitHub: https://github.com/chaoshorizon316/nnz
Branch: main
Render Web Service: nnz
Render Service ID: srv-d8go7pmq1p3s739r12jg
Render URL: https://nnz-kego.onrender.com
Render Environment: Production
Persistence: Postgres via DATABASE_URL
```

当前 `/healthz` 仍保持 Postgres 持久化：

```json
{
  "ok": true,
  "service": "nnz-mvp-demo",
  "fixture": "postgres",
  "persistence": {
    "mode": "postgres",
    "postgresConfigured": true,
    "postgresEnv": "DATABASE_URL",
    "sqliteConfigured": false
  }
}
```

## 已执行操作

1. 打开 Render Dashboard 的 `nnz` 服务环境变量页。
2. 确认已有变量：
   - `DATABASE_URL`
   - `NNZ_LLM_API_KEY`
   - `NNZ_LLM_BASE_URL`
   - `NNZ_LLM_MODEL`
3. 新增环境变量：
   - `NNZ_OPS_TOKEN`
4. 点击 `Save, rebuild, and deploy`。
5. Render 返回提示：环境变量已更新，并触发部署。

## 云端 Smoke 结果

部署前，`/api/ops/overview` 返回 404，符合“未配置 token 时后台未启用”的预期。

部署生效后验证结果：

```text
GET  /ops                         -> 200
GET  /api/ops/overview             -> 401  缺少 Soul Ops 访问 token
GET  /api/ops/overview wrong token -> 403  Soul Ops 访问 token 无效
GET  /api/ops/overview with token  -> 200
POST /api/ops/cleanup-test-users dry-run with token -> 200
```

带 token 的 overview 返回结构包含：

```text
generatedAt
persistence
totals
cleanupPlan
users
```

本次 overview 观察到：

```text
users: 3
```

cleanup dry-run 结果：

```json
{
  "dryRun": true,
  "candidateUsers": 1,
  "deletedUserIds": 0,
  "totals": {
    "users": 1,
    "personas": 1,
    "soulVersions": 1,
    "snapshots": 0,
    "memories": 1,
    "proposals": 0,
    "nodes": 0,
    "conversations": 2,
    "sessions": 1,
    "credentials": 1
  }
}
```

解释：

- 当前云端存在 1 个明确 smoke/test 用户候选。
- dry-run 没有执行真实删除，`deletedUserIds` 为 0。
- 清理计划仍通过 `deleteUserScopedData(userId)` 的设计约束执行，后续真删除也必须保持用户作用域隔离。

## 复核命令

不要把真实 token 写进命令历史、文档或仓库。临时验证时只在本地 shell 注入：

```bash
BASE='https://nnz-kego.onrender.com'
OPS_TOKEN='<Render 中配置的 NNZ_OPS_TOKEN>'

curl -i "$BASE/api/ops/overview"

curl -i "$BASE/api/ops/overview" \
  -H 'x-ops-token: wrong-token'

curl -s "$BASE/api/ops/overview" \
  -H "x-ops-token: $OPS_TOKEN"

curl -s -X POST "$BASE/api/ops/cleanup-test-users" \
  -H "x-ops-token: $OPS_TOKEN" \
  -H 'content-type: application/json' \
  -d '{"dryRun":true}'
```

只有在明确需要清理测试数据时，才允许执行真删除：

```json
{
  "dryRun": false,
  "confirm": "DELETE_TEST_USERS"
}
```

真删除前必须再次确认：

- 只删除明确 smoke/test 账号。
- 不删除 A/B demo 用户。
- 不删除普通用户。
- 不扩大匹配规则。
- 不绕过 `deleteUserScopedData(userId)`。

## 当前判断

Soul Ops 已完成从“本地受保护后台雏形”到“云端受 token 保护后台”的最小闭环。

这仍不是最终生产后台：

- `NNZ_OPS_TOKEN` 是 MVP 级后台保护。
- 还没有管理员登录、RBAC、审计日志、操作流水和删除回执。
- `/ops` 仍是内部治理台，不应进入用户端 H5 或微信端。

## 下一步计划

建议下一步进入 Step 2：Soul Ops 审计与权限。

优先顺序：

1. 增加 `OpsAuditEvent`：记录 overview 查看、cleanup dry-run、cleanup 真删除、操作者、时间、目标 userId、结果。
2. 增加持久化审计日志：Postgres 模式下不丢失，in-memory 模式可用于本地测试。
3. 增加后台 RBAC 雏形：`viewer` 只能看概览，`operator` 可 dry-run，`admin` 才能执行确认删除。
4. 给 cleanup 真删除增加二次确认和删除回执。
5. 将 snapshot persistence 逐步演进为 scoped repositories，避免长期依赖全量 JSON snapshot 覆盖。
6. 增加 Proposal Review Queue：按用户、persona、fieldPath、风险等级筛选。
7. 增加 Soul Maturity 趋势：记录每个 persona 的成熟度变化，支撑后台定向迭代。

## 给下一位 AI 的交接提醒

- 不要要求用户把 `NNZ_OPS_TOKEN` 明文贴到文档或仓库。
- 如果需要重新验证云端 `/ops`，让用户提供一次性本地环境变量，或在 Render 中轮换 token 后再验证。
- 不要点击 Render 的 `Show secret`，除非用户明确要求并理解风险。
- 不要把 `/ops` 合并回 `/demo` 或首页。
- 用户端继续保持机制无感，后台可以展示治理对象，但必须受保护。
- 所有 Soul / Memory / Snapshot / Node / Conversation 操作仍必须携带 `userId + personaId`。
