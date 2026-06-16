# nnz-mvp 2026-06-16 Step 2.1：Soul Ops 审计日志

## 目标

本次 Step 2.1 在已经云端启用的 `/ops` 后台上，补齐最小可用审计能力。

核心目标：

- 记录 Soul Ops 后台访问和操作。
- 记录授权拒绝、overview 查看、cleanup dry-run、cleanup 删除尝试。
- 审计事件随 store 持久化，在 Postgres snapshot 和 SQLite 模式下都能保存。
- `/ops` 页面能看到最近后台操作。
- 不记录 `NNZ_OPS_TOKEN` 明文，不把 token 写入仓库或文档。

## 已完成代码

新增/修改：

```text
nnz-mvp/src/domain/types.ts
nnz-mvp/src/domain/soul-store.ts
nnz-mvp/src/domain/persistence.ts
nnz-mvp/src/domain/postgres-persistence.ts
nnz-mvp/src/ops/ops-console.ts
nnz-mvp/src/demo-server.ts
nnz-mvp/src/ops/ops-console.test.ts
nnz-mvp/src/domain/persistence.test.ts
nnz-mvp/src/domain/postgres-persistence.test.ts
nnz-mvp/package.json
nnz-mvp/package-lock.json
```

新增类型：

```ts
type OpsAuditAction =
  | 'ACCESS_DENIED'
  | 'OVERVIEW_READ'
  | 'CLEANUP_DRY_RUN'
  | 'CLEANUP_DELETE';

type OpsAuditOutcome = 'SUCCESS' | 'DENIED' | 'FAILED';

interface OpsAuditEvent {
  id: string;
  action: OpsAuditAction;
  outcome: OpsAuditOutcome;
  actor: string;
  targetUserIds: string[];
  metadata: Record<string, string | number | boolean | null>;
  createdAt: Date;
}
```

Store 新增：

```ts
recordOpsAuditEvent(...)
listOpsAuditEvents(limit?)
```

## 审计覆盖范围

当前记录：

| 操作 | action | outcome |
|---|---|---|
| 缺少后台 token | `ACCESS_DENIED` | `DENIED` |
| 后台 token 错误 | `ACCESS_DENIED` | `DENIED` |
| 读取 `/api/ops/overview` | `OVERVIEW_READ` | `SUCCESS` |
| 执行 cleanup dry-run | `CLEANUP_DRY_RUN` | `SUCCESS` |
| 真删除但缺确认码 | `CLEANUP_DELETE` | `DENIED` |
| 真删除成功 | `CLEANUP_DELETE` | `SUCCESS` |

审计 metadata 当前只记录非敏感后台信息，例如：

- `path`
- `method`
- `reason`
- `dryRun`
- `candidateUsers`
- `deletedUsers`

不会记录：

- `NNZ_OPS_TOKEN` 明文。
- 请求里的 token。
- 用户聊天内容。
- 用户上传资料原文。

## 持久化

Postgres：

- 继续沿用当前 MVP 的 `nnz_store_snapshots` 全量 snapshot。
- `opsAuditEvents` 已纳入 `store.serialize()` 和 `store.deserialize()`。
- `normalizeSnapshot()` 会把 `createdAt` 恢复为 `Date`。

SQLite：

- 新增 `ops_audit_events` 表。
- `saveStore()` 写入审计事件。
- `loadStore()` 读取审计事件。
- 加了旧库兼容：如果旧 SQLite 文件没有 `ops_audit_events` 表，加载时按空审计列表处理。

## `/ops` 页面更新

新增：

- `Audit Events` 指标。
- 左侧“最近后台操作”面板。
- 展示最近 8 条事件：
  - action
  - outcome
  - actor
  - createdAt
  - target user 短 ID
  - metadata 摘要

这仍然是后台治理台，不进入首页 H5、微信端或 `/demo` 用户验证页。

## 验证结果

本地 iCloud 工作目录：

```text
npm run typecheck                         # passed
npx vitest run src/ops/ops-console.test.ts src/domain/postgres-persistence.test.ts
                                           # 2 files, 6 tests passed
npm audit                                  # 0 vulnerabilities
```

注意：iCloud 工作目录中的 `better-sqlite3` 原生包仍可能是 x86_64，直接跑 SQLite 测试会出现架构不匹配。这是既有环境问题，不是本次代码失败。

干净副本全量验证：

```text
/tmp/nnz-audit-verify.Pm31Tw
npm ci
npm run typecheck
npm test          # 10 files, 69 tests passed
npm run build:demo
npm audit         # 0 vulnerabilities
```

本地 API smoke：

```text
HOST=127.0.0.1 PORT=3052 NNZ_OPS_TOKEN=dev-ops-token node dist-cjs/demo-server.js
```

请求结果：

```json
{
  "noToken": "401",
  "wrongToken": "403",
  "overviewCode": "200",
  "cleanupCode": "200",
  "finalCode": "200",
  "auditTotal": 5,
  "auditActions": [
    "OVERVIEW_READ:SUCCESS",
    "CLEANUP_DRY_RUN:SUCCESS",
    "OVERVIEW_READ:SUCCESS",
    "ACCESS_DENIED:DENIED",
    "ACCESS_DENIED:DENIED"
  ],
  "totalsAuditEvents": 5
}
```

## 安全修复说明

本次全量验证时，`npm audit` 新报出 `esbuild <0.28.1` 的高危公告。该依赖由 `tsx` / `vite` / `vitest` 间接引入。

处理方式：

```json
{
  "overrides": {
    "esbuild": "^0.28.1"
  }
}
```

这没有升级 `tsx`、`vite` 或 `vitest` 主版本，只把传递依赖 `esbuild` 钉到修复版本。干净副本验证后 `npm audit` 为 0 vulnerabilities。

## 作用域审计

本次没有改变 Soul Runtime、Memory Retrieval、LLM prompt 或用户端 H5。

保持：

- Soul / Memory / Snapshot / Node / Conversation 仍按 `userId + personaId` 操作。
- cleanup 真删除仍必须走 `deleteUserScopedData(userId)`。
- 不做跨用户 Soul 聚合。
- 不把用户 A 的记忆、纠正、节点事件用于用户 B。
- 审计事件是后台治理对象，不进入用户端回复。

## 下一步计划

建议进入 Step 2.2：Soul Ops RBAC 与删除回执。

优先顺序：

1. 增加 ops token -> role 映射：
   - `viewer`
   - `operator`
   - `admin`
2. `viewer` 只能读 overview。
3. `operator` 可以执行 cleanup dry-run。
4. `admin` 才能执行 `dryRun:false` + `DELETE_TEST_USERS` 真删除。
5. cleanup 真删除返回删除回执，并把回执写入 audit metadata。
6. `/ops` 页面按角色禁用危险按钮。
7. 云端 Render 需要配置角色化 token 时，不记录 token 明文。

## 给下一位 AI 的提醒

- 不要把审计日志展示到首页或微信端。
- 不要在 audit metadata 中记录 token、聊天内容、上传资料原文。
- 不要把 `actor: "ops-token"` 误认为最终身份体系；它只是 Step 2.1 的 MVP 占位。
- Step 2.2 做 RBAC 时，优先保持向后兼容：现有 `NNZ_OPS_TOKEN` 可先视为 `admin`，再增加可选的多 token 配置。
- 任何删除能力都必须继续保守匹配 smoke/test 用户，不能扩大到普通用户。
