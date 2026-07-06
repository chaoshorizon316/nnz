# nnz-mvp 2026-07-06 Step 2.28 User Data Export/Delete

## 目标

把用户自己的数据导出与删除闭环接入 `ScopedRuntimeAdapter`，让默认 snapshot/InMemory 路径和 guarded scoped Postgres runtime 路径拥有一致的用户数据主权接口。

## 已完成

- `ScopedRuntimeAdapter` 新增 `exportUserData(userId)` 与 `deleteUserData(userId)`。
- 新增统一 `UserDataExport` / `DeleteUserDataResult` 结构。
- InMemory adapter 通过现有 store 的 scope-safe list 方法导出当前用户数据，再调用 `deleteUserScopedData(userId)` 删除。
- Postgres scoped adapter 先列出当前用户 personas，再按每个 `{ userId, personaId }` 绑定 repository 读取 SoulVersion、SoulSnapshot、Memory、Proposal、Node、Conversation 和 RuntimeSession。
- `InMemorySoulStore`、`ScopedSoulRepository`、`PostgresScopedSoulRepository` 补充 scope-safe `listSoulSnapshots()`。
- `GET /api/me/export` 返回当前登录用户自己的数据档案。
- `POST /api/me/delete` 需要 `confirm:"DELETE_MY_DATA"`，只删除当前登录用户。
- 首页 H5 登录态新增“导出”和“删除全部数据”操作。

## 安全边界

- 导出包含当前用户自己的 personas、Soul versions、snapshots、memories、proposals、nodes、conversations、sessions 和账号邮箱元数据。
- 导出不包含 credential password hash，也不暴露后台 OpsAudit。
- 删除从 JWT auth user 取 userId，不接受前端传 userId。
- scoped Postgres 删除通过 `DELETE FROM nnz_users WHERE id = $1` 触发 FK cascade，只清理当前用户的 scoped tables。
- Postgres 导出读取 Soul/Memory/Snapshot/Node/Conversation/Proposal/Session 时都携带 `userId + personaId`。
- H5 可见文案不暴露 SoulVersion、SoulSnapshot、scope、evidence 等内部机制。

## 验证

```text
npm test -- src/runtime/scoped-runtime-adapter.test.ts --reporter verbose: 5 tests passed
npm run typecheck: passed
npm test: 26 passed / 2 skipped test files, 157 passed / 2 skipped tests
npm run build:demo: passed
git diff --check: passed
local /api/me export/delete smoke: passed
```

## 仍未完成

- 尚未用真实 disposable `NNZ_POSTGRES_SCOPED_RUNTIME_URL` 跑 `/api/me/*` scoped Postgres HTTP smoke。
- 尚未跑真实 snapshot readiness、一次性 Postgres migration smoke、Render viewer/operator/admin role token smoke。
