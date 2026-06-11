# nnz-mvp 2026-06-11 Step 1：Soul Ops 独立后台与测试数据清理

## 目标

本次 Step 1 目标是先解决两个问题：

1. 后台测试数据清理：Render Postgres 已经持久化，后续 smoke 用户会长期堆积，需要可控清理能力。
2. Soul Ops 独立后台雏形：后台治理不能继续混在 `/demo` 验证页里，应拆成单独 `/ops`，并与用户端 H5 / 微信体验隔离。

核心边界保持不变：

- 不同用户拥有不同 Soul。
- Soul / Memory / Snapshot / Node / Conversation 的唯一作用域仍是 `userId + personaId`。
- 用户端不展示 `SoulVersion`、`SoulUpdateProposal`、`scope`、`userId`、`personaId` 等后台机制。
- 后台可以展示这些治理对象，但必须受保护，不对普通用户开放。

## 已完成代码

新增：

```text
nnz-mvp/src/ops/ops-console.ts
nnz-mvp/src/ops/ops-console.test.ts
```

修改：

```text
nnz-mvp/src/demo-server.ts
nnz-mvp/README.md
nnz-mvp/CLAUDE_CODE_HANDOFF.md
CLAUDE_CODE_HANDOFF.md
nnz-mvp-CURRENT-STATE.md
```

## 新增后台入口

页面：

```text
GET /ops
```

API：

```text
GET  /api/ops/overview
POST /api/ops/cleanup-test-users
```

启用环境变量：

```bash
NNZ_OPS_TOKEN=<strong-random-token>
```

权限规则：

- 未配置 `NNZ_OPS_TOKEN`：`/ops` 显示后台未启用，`/api/ops/*` 返回 404。
- 已配置但请求缺 token：返回 401。
- token 错误：返回 403。
- token 可放在 `x-ops-token`，也可放在 `Authorization: Bearer ...`。

## `/ops` 页面能力

当前页面是后台雏形，不是最终生产后台。

已展示：

- Users
- Personas
- Memories
- Pending Proposals
- Nodes
- Conversations
- Test Users
- Persistence mode
- 用户表：displayName/email、demo/test 标识、计数、创建时间
- Persona 成熟度卡片：score、level、runtimeState、scope 短 ID、六维成熟度、recommendations
- 测试数据清理面板：dry-run、确认码、执行清理

页面验证结果：

```text
本地 URL: http://127.0.0.1:3041/ops
token: dev-ops-token
结果: 页面正常展示 8 个指标、2 个 demo 用户、2 个 Persona 成熟度卡片和清理面板
```

## 测试数据清理规则

接口默认 dry-run：

```bash
curl -X POST http://127.0.0.1:3041/api/ops/cleanup-test-users \
  -H 'x-ops-token: dev-ops-token' \
  -H 'content-type: application/json' \
  -d '{"dryRun":true}'
```

真删除必须显式确认：

```json
{
  "dryRun": false,
  "confirm": "DELETE_TEST_USERS"
}
```

匹配规则刻意保守，仅识别明确 smoke/test 账号：

- `@example.test`
- `codex-postgres-smoke-*`
- `codex-ops-smoke-*`
- `nnz-smoke-*`

不会因为普通用户名字里出现 test 字样就删除。

删除执行路径：

```ts
store.deleteUserScopedData(userId)
```

会删除该用户自己的：

- Persona
- SoulVersion
- SoulSnapshot
- MemoryItem
- SoulUpdateProposal
- NodeEvent
- ConversationMessage
- RuntimeSession
- Credential
- User

不会删除其他用户数据，也不会删除 A/B demo 用户。

## 本地 API Smoke

启动方式：

```bash
cd nnz-mvp
npm run build:demo
cd /tmp
HOST=127.0.0.1 PORT=3041 NNZ_OPS_TOKEN=dev-ops-token node "/Users/will/Library/Mobile Documents/iCloud~md~obsidian/Documents/黑曜石知识库/Personal/我还在/nnz-mvp/dist-cjs/demo-server.js"
```

说明：本机 `nnz-mvp/.env` 当前配置了 `NNZ_DB_PATH`，但本地 `better-sqlite3` 原生包存在 x86_64/arm64 架构不匹配。为避免误判，本次从 `/tmp` 启动已构建 server，避开 `.env`，用 in-memory 模式验证后台逻辑。

验证结果：

```json
{
  "noToken": {
    "status": 401,
    "error": "缺少 Soul Ops 访问 token。"
  },
  "initialOverview": {
    "users": 2,
    "personas": 2,
    "testUsers": 0,
    "mode": "memory"
  },
  "afterCreateSmokeUser": {
    "users": 3,
    "testUsers": 1
  },
  "dryRun": {
    "dryRun": true,
    "users": 1,
    "deleted": 0
  },
  "cleanup": {
    "dryRun": false,
    "plannedUsers": 1,
    "deleted": 1
  },
  "afterCleanup": {
    "users": 2,
    "testUsers": 0,
    "demoUsers": 2
  }
}
```

## 测试覆盖

新增测试文件：

```text
src/ops/ops-console.test.ts
```

覆盖：

- overview 能按用户/persona 汇总成熟度，不混 scope。
- cleanup plan 只识别明确 smoke account。
- dry-run 不改数据。
- 确认清理只删测试用户。
- A/B demo 用户和普通用户保留。

干净环境全量验证：

```text
/tmp/nnz-step1-final.MF0YVg
npm ci
npm run typecheck
npm test
npm run build:demo
npm audit
```

结果：

```text
typecheck passed
10 test files passed
67 tests passed
build:demo passed
audit passed, 0 vulnerabilities
```

本地 iCloud 工作目录直接 `npm test` 仍会因 `better-sqlite3` 原生包架构不匹配导致 SQLite 测试失败；这不是本次源码问题。可靠判断以 `/tmp` 干净安装结果为准。

## Render / Cloud 依赖

当前云端：

```text
URL: https://nnz-kego.onrender.com
Render Web Service: nnz
Service ID: srv-d8go7pmq1p3s739r12jg
Postgres: nnz-mvp-postgres
Postgres ID: dpg-d8l271hkh4rs73fmdtn0-a
Persistence env: DATABASE_URL
Healthz: fixture="postgres"
```

要在云端启用 `/ops`，下一步需要在 Render Web Service 配置：

```text
NNZ_OPS_TOKEN=<strong-random-token>
```

配置后重新部署，并验证：

```bash
curl -i https://nnz-kego.onrender.com/api/ops/overview
# 预期 401 或 403，不应返回数据

curl -s https://nnz-kego.onrender.com/api/ops/overview \
  -H 'x-ops-token: <token>'
# 预期返回 totals/users/cleanupPlan

curl -s -X POST https://nnz-kego.onrender.com/api/ops/cleanup-test-users \
  -H 'x-ops-token: <token>' \
  -H 'content-type: application/json' \
  -d '{"dryRun":true}'
# 预期只返回清理预案，不删除
```

生产注意：当前 `NNZ_OPS_TOKEN` 只是 MVP 级后台保护，不是最终 RBAC。后续必须加管理员身份、角色权限、审计日志和操作二次确认。

## 下一步计划

建议顺序：

1. 云端配置 `NNZ_OPS_TOKEN`，做 `/ops` 和 cleanup dry-run smoke。
2. 给 Soul Ops 增加 audit log：谁在何时查看、dry-run、删除了哪些 userId，结果是什么。
3. 加管理员 RBAC：至少区分 viewer / operator / admin。
4. 把 Postgres snapshot persistence 演进为 scoped repositories，避免每次全量覆盖 JSON snapshot。
5. 后台增加 Proposal Review Queue：按用户、persona、fieldPath、风险等级筛选提案。
6. 后台增加 Soul Maturity 趋势：记录每个 persona 每日/每次更新后的 maturity snapshot，帮助判断迭代优先级。

## 给下一位 AI 的提醒

- 不要把 `/ops` 合回 `/demo` 或首页。
- 不要让用户端出现 `userId`、`personaId`、scope、SoulVersion、Proposal、evidence 这些机制词。
- 清理测试数据时只删明确 smoke/test 用户，不要扩大匹配规则。
- 真删除必须继续走 `deleteUserScopedData(userId)`，不要手写跨表删除绕过 scope 规则。
- 如果要改 Render，请先确认当前 Postgres 仍为 `fixture:"postgres"`，并保留 `DATABASE_URL`。
