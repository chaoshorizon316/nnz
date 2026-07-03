# nnz-mvp 2026-07-03 Step 2.23 `/api/me/*` Scoped Runtime Adapter Wiring

## 当前结论

Step 2.23 已把用户端 `/api/me/*` flow 接到 InMemory `ScopedRuntimeAdapter` 上。默认 snapshot / SQLite / Postgres JSONB 持久化语义不变，但用户端调用形状已经从直接 `fixture.store.*` 逐步迁到 adapter 层。

这一步不是 scoped Postgres runtime cutover。`NNZ_RUNTIME_PERSISTENCE_MODE=scoped` 仍应保持受保护，直到后续把 guarded runtime mode 接到 `createPostgresScopedRuntimeAdapter(...)` 并完成真实 smoke。

## 代码变更

修改：

```text
nnz-mvp/src/demo-server.ts
```

主要变化：

- 引入 `createInMemoryScopedRuntimeAdapter(fixture.store)`。
- `/api/register` / `/api/login` 的 credential 查询与写入走 `ScopedRuntimeAdapter`。
- `/api/me` / `/api/me/personas` 通过 adapter 列出 personas，并用 bound runtime adapter 统计 memory/message。
- `/api/me/persona` 通过 adapter 创建 persona、SoulVersion 和 DESCRIPTION memory。
- `/api/me/chat-history` / `/api/me/chat` 通过 `ScopedPersonaRuntimeAdapter` 读取 persona、conversation、runtime context，并写入 user/assistant conversation。
- `/api/me/covenant-state` / `/api/me/seal` / `/api/me/activate-node` / `/api/me/complete-node` / `/api/me/graduate` 通过 bound adapter 读取或切换 Covenant state。

保留不变：

- A/B 开发者 `/demo` flow 仍走原 store 路径。
- Soul Ops overview / cleanup / audit 仍走原 store 路径。
- snapshot persistence、SQLite persistence、Postgres JSONB persistence 仍按原语义保存完整 `InMemorySoulStore` snapshot。

## Scope 审计

用户端 flow 现在统一先通过 JWT 得到 `userId`，再由 adapter `forPersona({ userId, personaId })` 绑定 persona runtime。`requireUserPersonaRuntime(...)` 会先读取 persona，保留原先的 403/404 错误映射。

新增 helper：

```text
requireUserPersonaRuntime(...)
applyUserRuntimeSafetyGuard(...)
getLastUserRuntimeAssistantReply(...)
isDuplicateUserRuntimeMessage(...)
summarizeUserPersona(...)
serializeUserMessages(...)
```

这些 helper 都围绕 bound `ScopedPersonaRuntimeAdapter` 工作，避免用户端新增 persona-only 查询。

## 验证

本地验证：

```text
npm run typecheck
npm test
npm run build:demo
```

结果：

```text
typecheck: passed
full test suite: 23 test files passed, 2 skipped; 141 tests passed, 2 skipped
build:demo: passed
```

本地 API smoke：

```text
启动方式：从 /tmp 启动 dist-cjs/demo-server.js，避开项目 .env，只走 in-memory mode
HOST=127.0.0.1 PORT=3117 node <repo>/nnz-mvp/dist-cjs/demo-server.js
```

覆盖：

- `POST /api/register`
- `POST /api/me/persona`
- `GET /api/me`
- `POST /api/me/chat`
- `GET /api/me/chat-history`
- `POST /api/me/seal`
- `POST /api/me/activate-node`
- `POST /api/me/complete-node`

结果：

```text
personaCount: 1
createdMessages: 0
replyLength: 42
historyMessages: 2
sealed: SEALED
node: NODE
nodeName: 生日
completed: SEALED
noLeak: true
```

## 仍未完成

- `NNZ_RUNTIME_PERSISTENCE_MODE=scoped` 仍未接到 Postgres scoped adapter。
- Ops/cleanup/export/delete 尚未通过 scoped runtime / repository 层收口。
- 真实 local snapshot readiness、disposable Postgres smoke、Render role token smoke 仍依赖外部输入或操作窗口。

## 下一步建议

继续目标 4：把 guarded scoped runtime mode 接到 `createPostgresScopedRuntimeAdapter(pool)`，只允许通过 `NNZ_POSTGRES_SCOPED_RUNTIME_URL`，并先为 `/api/me/*` 做 scoped Postgres smoke；默认线上路径继续保持 snapshot persistence，直到验证闭环完成。
