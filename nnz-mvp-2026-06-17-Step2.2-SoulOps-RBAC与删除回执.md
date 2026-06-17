# nnz-mvp 2026-06-17 Step 2.2：Soul Ops RBAC 与删除回执

## 目标

本次 Step 2.2 在 Step 2.1 审计日志基础上，补齐 Soul Ops 的最小角色权限和删除回执。

核心目标：

- 将单一后台 token 演进为角色化后台访问。
- 保持旧 `NNZ_OPS_TOKEN` 向后兼容，默认视为 `admin`。
- 增加 `viewer` / `operator` / `admin` 三层权限。
- cleanup 真删除必须只有 `admin` 可执行。
- cleanup 真删除返回可审计的删除回执。
- `/ops` 页面展示当前角色和权限，并按权限禁用危险按钮。

## 已完成代码

新增：

```text
nnz-mvp/src/ops/ops-auth.ts
nnz-mvp/src/ops/ops-auth.test.ts
```

修改：

```text
nnz-mvp/src/demo-server.ts
nnz-mvp/src/ops/ops-console.ts
nnz-mvp/src/ops/ops-console.test.ts
nnz-mvp/tsconfig.demo.json
```

## 后台角色

新增角色：

```ts
type OpsRole = 'viewer' | 'operator' | 'admin';
```

权限：

| Role | Overview | Cleanup dry-run | Cleanup delete |
|---|---:|---:|---:|
| viewer | yes | no | no |
| operator | yes | yes | no |
| admin | yes | yes | yes |

当前兼容策略：

- `NNZ_OPS_TOKEN` 仍可使用。
- 旧 `NNZ_OPS_TOKEN` 映射为 `admin`，actor 为 `ops:legacy-admin`。
- 这保证 Render 当前配置无需立刻变更。

新增可选环境变量：

```text
NNZ_OPS_VIEWER_TOKEN
NNZ_OPS_OPERATOR_TOKEN
NNZ_OPS_ADMIN_TOKEN
```

后续云端若要分权，只需要在 Render 添加这些变量并重新部署。不要把 token 明文写入仓库或文档。

## 删除回执

`cleanupTestUsers(..., false)` 现在返回：

```ts
interface OpsCleanupReceipt {
  userId: string;
  displayName: string;
  email: string | null;
  reason: string;
  counts: OpsCleanupPlan['totals'];
  deletedAt: string;
  status: 'DELETED';
}
```

`OpsCleanupResult` 新增：

```ts
receipts: OpsCleanupReceipt[];
```

说明：

- dry-run 不生成 receipt。
- 真删除会为每个删除用户生成 receipt。
- receipt 使用删除前的 cleanup plan 计数，便于人工复核。
- 删除仍然通过 `store.deleteUserScopedData(userId)`，不绕过用户作用域。

## API 行为

`GET /api/ops/overview`

- viewer/operator/admin 都可以访问。
- 返回新增字段：
  - `principal`
  - `permissions`

`POST /api/ops/cleanup-test-users`

- viewer 请求 dry-run：403。
- operator 请求 dry-run：200。
- operator 请求真删除：403。
- admin 请求真删除但缺确认码：400。
- admin 请求真删除且确认码正确：200，并返回 `receipts`。

所有拒绝和成功路径仍会写入 audit：

- `actor`
- `actorRole`
- `requiredRole`
- `candidateUsers`
- `deletedUsers`
- `receipts`

不记录 token 明文。

## `/ops` 页面变化

新增“访问角色”面板：

- 当前 role。
- 当前 actor。
- Overview / Dry-run / Delete / Audit 权限。

清理面板：

- viewer：Dry-run 和确认清理按钮禁用。
- operator：Dry-run 可用，确认清理禁用。
- admin：Dry-run 和确认清理都可用。

真删除成功状态会提示删除用户数和回执数。

## 验证结果

本地工作目录：

```text
npm run typecheck
npx vitest run src/ops/ops-auth.test.ts src/ops/ops-console.test.ts src/domain/postgres-persistence.test.ts
npm run build:demo
```

结果：

```text
typecheck passed
3 test files passed
9 tests passed
build:demo passed
```

本地 API smoke：

```text
HOST=127.0.0.1 PORT=3053 \
NNZ_OPS_VIEWER_TOKEN=viewer-token \
NNZ_OPS_OPERATOR_TOKEN=operator-token \
NNZ_OPS_ADMIN_TOKEN=admin-token \
node dist-cjs/demo-server.js
```

权限边界结果：

```json
{
  "viewerOverview": "200",
  "viewerDry": "403",
  "operatorDry": "200",
  "operatorDelete": "403",
  "adminMissingConfirm": "400",
  "adminDelete": "200",
  "finalOverview": "200"
}
```

删除回执 smoke：

```json
{
  "beforeTestUsers": 1,
  "deletedUserIds": 1,
  "receipts": 1,
  "afterTestUsers": 0
}
```

干净副本全量验证：

```text
/tmp/nnz-step22-verify.jyhpib
npm ci
npm run typecheck
npm test          # 11 files, 72 tests passed
npm run build:demo
npm audit         # 0 vulnerabilities
```

## 重要修复

新增 `src/ops/ops-auth.ts` 后，`tsconfig.demo.json` 必须包含 `src/ops/**/*.ts`，否则 Render 的 `build:demo` 会找不到模块。

已修复：

```json
"include": [
  "src/demo-server.ts",
  "src/domain/**/*.ts",
  "src/runtime/**/*.ts",
  "src/ops/**/*.ts"
]
```

## 作用域审计

本次没有改变用户端 H5、微信端、LLM runtime、Memory retrieval 或 Soul 更新规则。

保持：

- 用户端仍不展示后台机制。
- `/ops` 是内部后台治理台。
- cleanup 只匹配明确 smoke/test 用户。
- 真删除仍走 `deleteUserScopedData(userId)`。
- 不做跨用户 Soul 合并。
- 不把 A 用户记忆污染到 B 用户。

## 下一步计划

建议进入 Step 2.3：Soul Ops 审计查询与云端角色化配置。

优先顺序：

1. 在 `/api/ops/overview` 之外增加审计查询接口：
   - 分页。
   - action 筛选。
   - actor 筛选。
   - targetUserId 筛选。
2. `/ops` 页面增加 Audit tab，而不是只显示最近 8 条。
3. 在 Render 增加可选角色 token：
   - `NNZ_OPS_VIEWER_TOKEN`
   - `NNZ_OPS_OPERATOR_TOKEN`
   - `NNZ_OPS_ADMIN_TOKEN`
4. 云端 smoke 验证 viewer/operator/admin 权限。
5. 保留旧 `NNZ_OPS_TOKEN` 一段时间，确认新 token 可用后再考虑轮换。
6. 后续再进入 scoped repositories，将当前 Postgres snapshot persistence 拆成逐表存储。

## 给下一位 AI 的提醒

- 不要要求用户把任何 ops token 明文写进知识库。
- 不要删除旧 `NNZ_OPS_TOKEN` 兼容逻辑，除非云端已完成角色 token 迁移并验证。
- 不要让 viewer/operator 绕过权限执行真删除。
- 删除回执是后台审计对象，不能进入用户端体验。
- 如果要做云端验证，先确认 Render 当前仍是 `fixture:"postgres"`。
