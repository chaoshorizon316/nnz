# nnz-mvp 2026-06-17 Step 2.3：Soul Ops Audit 查询与角色云端验证

## Summary

本次 Step 2.3 在 Step 2.2 RBAC 基础上，补齐 Soul Ops 审计查询闭环：

- 新增 `/api/ops/audit-events` 查询接口。
- 新增 `/ops` 后台 `Dashboard / Audit` tab。
- Audit tab 支持按 `action`、`actor`、`targetUserId` 查询，并支持 `limit / offset` 分页。
- 新增 `AUDIT_QUERY` 审计动作，查询审计本身也会被记录。
- 本地已验证 viewer/admin token 都能查询审计；viewer 仍不能执行 cleanup dry-run 或删除。

重要边界不变：

- 用户端首页、微信/H5 体验不暴露 Soul Ops、Audit、SoulVersion、MemoryItem、Proposal 等后台机制。
- Soul / Memory / Snapshot / Conversation 仍只按 `userId + personaId` 作用域访问。
- Audit metadata 不记录 token 明文，不记录用户聊天正文，不记录上传内容。

## Code Changes

### 1. Domain type

文件：`nnz-mvp/src/domain/types.ts`

新增审计动作：

```ts
export type OpsAuditAction =
  | 'ACCESS_DENIED'
  | 'OVERVIEW_READ'
  | 'CLEANUP_DRY_RUN'
  | 'CLEANUP_DELETE'
  | 'AUDIT_QUERY';
```

### 2. Ops console helper

文件：`nnz-mvp/src/ops/ops-console.ts`

新增：

- `OpsAuditQuery`
- `OpsAuditQueryResult`
- `queryOpsAuditEvents(store, query)`

查询能力：

- `action`：精确匹配审计动作。
- `actor`：精确匹配后台操作者，例如 `ops:admin` / `ops:viewer`。
- `targetUserId`：匹配 `event.targetUserIds`。
- `limit`：默认 20，范围 1-100。
- `offset`：默认 0，负数会 clamp 到 0。

返回结构包含：

- `generatedAt`
- `filters`
- `pagination`
- `events`

### 3. Demo server API

文件：`nnz-mvp/src/demo-server.ts`

新增：

```text
GET /api/ops/audit-events
```

调用方式：

```bash
curl -H "x-ops-token: <token>" \
  "https://nnz-kego.onrender.com/api/ops/audit-events?action=AUDIT_QUERY&actor=ops:admin&limit=20&offset=0"
```

支持参数：

```text
action=ACCESS_DENIED | OVERVIEW_READ | CLEANUP_DRY_RUN | CLEANUP_DELETE | AUDIT_QUERY
actor=ops:viewer | ops:operator | ops:admin | ops:legacy-admin
targetUserId=user_...
limit=20
offset=0
```

权限：

- 仍使用 `requireOpsAccess()`。
- 有效 Soul Ops token 即可查询审计事件。
- 目前 `viewer` 也可查询 audit，这是有意设计：viewer 是只读后台角色。
- 删除能力仍仅限 `admin`。

审计行为：

- 每次查询会先记录一条 `AUDIT_QUERY`。
- metadata 只记录查询参数和 `actorRole`。
- 如果带 `targetUserId` 查询，该 userId 会进入 `targetUserIds`，便于之后反查谁查询过某个用户相关审计。

### 4. `/ops` Admin UI

文件：`nnz-mvp/src/demo-server.ts`

新增内部 tab：

- `Dashboard`
- `Audit`

Audit tab 能力：

- Action 下拉筛选。
- Actor 输入筛选。
- Target userId 输入筛选。
- Limit 选择 20 / 50 / 100。
- 上一页 / 下一页分页。
- 表格列：Action、Actor、Targets、Metadata、Created。

Dashboard 原有能力保留：

- 访问角色面板。
- 测试数据 cleanup dry-run / 确认删除。
- 最近后台操作摘要。
- 用户总览与 Persona 成熟度卡片。

## Local Verification

### Current workspace

```bash
cd nnz-mvp
npm run typecheck
npm test -- src/ops/ops-console.test.ts src/ops/ops-auth.test.ts
npm run build:demo
```

结果：

```text
typecheck: passed
ops tests: 2 files passed, 8 tests passed
build:demo: passed
```

注意：当前 iCloud 工作区里的 `node_modules/better-sqlite3` 是 x86_64，本机 Node 需要 arm64，因此直接 `npm test` 会在 SQLite persistence 测试报架构不匹配。这不是 Step 2.3 代码问题。

### Clean `/tmp` verification

干净副本：

```text
/tmp/nnz-step23-verify.iLBxJh
```

命令：

```bash
cd /tmp/nnz-step23-verify.iLBxJh/nnz-mvp
npm ci
npm test
npm run typecheck
npm run build:demo
```

结果：

```text
npm ci: passed
npm test: 11 files passed, 73 tests passed
npm run typecheck: passed
npm run build:demo: passed
```

### Local API smoke

临时服务：

```bash
HOST=127.0.0.1 \
PORT=3057 \
NNZ_OPS_VIEWER_TOKEN=viewer-token \
NNZ_OPS_OPERATOR_TOKEN=operator-token \
NNZ_OPS_ADMIN_TOKEN=admin-token \
node dist-cjs/demo-server.js
```

验证结果：

```text
GET /ops -> 200
GET /api/ops/audit-events?action=AUDIT_QUERY&actor=ops:admin&limit=2&offset=0
  -> 200, principal.role=admin, events[0].action=AUDIT_QUERY
GET /api/ops/overview with viewer-token
  -> 200, principal.role=viewer, canDeleteCleanup=false
GET /api/ops/audit-events?limit=1 with viewer-token
  -> 200, principal.role=viewer, pagination.hasMore=true
```

页面 HTML 已确认包含：

```text
Dashboard tab
Audit tab
Audit Events
auditAction
/api/ops/audit-events
```

## Render / Cloud Status

已知线上信息：

```text
Render URL: https://nnz-kego.onrender.com
Render Web Service: nnz
Render Service ID: srv-d8go7pmq1p3s739r12jg
GitHub repo: https://github.com/chaoshorizon316/nnz
```

Render 目前已配置：

```text
DATABASE_URL
NNZ_LLM_API_KEY 等 LLM 环境变量
NNZ_OPS_TOKEN
```

Step 2.2 新增但云端是否已配置，需下一步确认：

```text
NNZ_OPS_VIEWER_TOKEN
NNZ_OPS_OPERATOR_TOKEN
NNZ_OPS_ADMIN_TOKEN
```

兼容策略：

- 如果 Render 只有旧 `NNZ_OPS_TOKEN`，`/ops` 仍可用，并且旧 token 映射为 `admin`。
- 如果要启用角色化后台访问，在 Render 添加三个可选 token 并重新部署即可。
- token 明文不得写入仓库、文档或聊天记录。

云端角色 token 验证建议：

```bash
BASE_URL="https://nnz-kego.onrender.com"

curl -i "$BASE_URL/api/ops/audit-events"
# 预期：401

curl -i -H "x-ops-token: wrong-token" "$BASE_URL/api/ops/audit-events"
# 预期：403

curl -s -H "x-ops-token: <viewer-token>" "$BASE_URL/api/ops/audit-events?limit=1"
# 预期：200, principal.role=viewer

curl -s -H "x-ops-token: <operator-token>" "$BASE_URL/api/ops/cleanup-test-users" \
  -H "content-type: application/json" \
  -d '{"dryRun":true}'
# 预期：200, dryRun=true

curl -i -H "x-ops-token: <viewer-token>" "$BASE_URL/api/ops/cleanup-test-users" \
  -H "content-type: application/json" \
  -d '{"dryRun":true}'
# 预期：403

curl -s -H "x-ops-token: <admin-token>" "$BASE_URL/api/ops/audit-events?action=CLEANUP_DRY_RUN&limit=20"
# 预期：200，并看到前面的 dry-run 审计记录
```

## Test Coverage Added

文件：`nnz-mvp/src/ops/ops-console.test.ts`

新增测试：

```text
queries ops audit events by action, actor, target user, and pagination
```

覆盖：

- `action=AUDIT_QUERY`
- `actor=ops:operator`
- `targetUserId=<smoke user>`
- `limit=2, offset=0`
- `limit=2, offset=2`
- `limit` clamp 到 100
- `offset` clamp 到 0
- 返回内容不包含 token 字符串

## Known Issues / Notes

1. 当前仓库没有独立的 `scripts/audit-mechanism-leaks.cjs`，机制泄露检查由 runtime / guard 测试覆盖。
2. 当前 iCloud 工作区 `node_modules/better-sqlite3` 架构污染会导致直接全量 `npm test` 误报失败；可靠验证方式是 `/tmp` 干净副本 `npm ci`。
3. Audit 查询会记录 `AUDIT_QUERY` 自身，因此查询 audit 的总数会自然增长。这是预期行为。
4. `targetUserId` 查询会把查询目标也写入该 `AUDIT_QUERY` 的 `targetUserIds`，便于审计“谁查过这个用户相关事件”。

## Next Plan

建议下一步进入 Step 2.4：

1. 推送 Step 2.3 后等待 GitHub Actions。
2. 如果用户已在 Render 添加角色化 token，做云端 smoke：
   - `/api/ops/audit-events` 401 / 403 / viewer 200。
   - viewer 不能 cleanup。
   - operator 能 dry-run 但不能 delete。
   - admin 能查所有 audit。
3. 将 `/ops` 从 demo-server 内联 HTML 继续拆成更清晰的 Admin Web 模块。
4. 开始 scoped repository 设计：
   - 从 Postgres snapshot persistence 演进为逐表 repository。
   - 所有 Soul / Memory / Snapshot / Proposal / Conversation 查询继续强制携带 `userId + personaId`。
5. 增加审计导出/保留策略：
   - 支持按时间范围导出。
   - 支持只导出 metadata，不导出用户内容。
   - 支持后台安全巡检。

