# nnz-mvp 2026-07-08 Step 2.42 Scoped Runtime Daily Usage

## 背景

Step 2.40/2.41 已通过 `adac0ea feat: add h5 memory append and graduation confirmation` 推送。继续沿产品进程审计里的安全边界补强，检查到 H5 `/api/me/chat` 的 scoped runtime 路径会读取 `RuntimeSession` 并执行每日限额检查，但在 Postgres scoped runtime 下，`incrementDailyCount(session)` 只修改了 `getRuntimeSession()` 返回的对象副本，没有显式写回 `nnz_runtime_sessions`。

这意味着默认内存 fixture 可以累计每日消息数，但 scoped Postgres runtime 可能无法持久累计，进而让“每日使用有健康上限”的产品承诺在真实 scoped runtime 模式下失效。

## 本次变更

- `ScopedPersonaRuntimeAdapter` 新增 `updateRuntimeUsage({ dailyMessageCount, lastMessageDate })`。
- InMemory scoped runtime repository 直接更新当前 scope 的 session usage 字段。
- `PostgresScopedSoulRepository` 新增同名方法：先读取当前 session，再只替换 `dailyMessageCount` / `lastMessageDate`，通过既有 `setSession()` upsert 回 `nnz_runtime_sessions`，保留 state、snapshot、node context。
- `applyUserRuntimeSafetyGuard()` 在 `checkDailyLimit()` 通过后执行 `incrementDailyCount(session)`，并显式调用 `runtime.updateRuntimeUsage()`，让 H5 用户真实聊天路径在 scoped mode 下也会落库累计。
- 旧 fixture guard 仍保持同步内存路径，不改变 demo fixture 语义。

## 回归覆盖

- `src/runtime/scoped-runtime-adapter.test.ts`：验证 usage update 不会改变 NODE covenant context。
- `src/domain/postgres-scoped-soul-repository.test.ts`：验证 Postgres scoped repository 更新 usage 后仍保留 `userId + personaId`、NODE state、snapshot 和 node context，且不影响其他用户/persona。
- `src/demo-server-consent.test.ts`：源码级固定 H5 scoped runtime guard 路径在 `checkDailyLimit()` 后、`incrementDailyCount()` 后会调用 `runtime.updateRuntimeUsage()`。

## 本地验证

```text
npm test -- scoped-runtime-adapter postgres-scoped-soul-repository demo-server-consent
3 passed | 1 skipped; 18 passed | 1 skipped

npm run typecheck
passed

npm test
34 passed | 2 skipped; 218 passed | 2 skipped

npm run build:demo
passed

git diff --check
passed
```

## 状态

- 本地 Step 2.42 已完成，尚待下一次合并 push。
- 最新已推送提交仍是 `adac0ea feat: add h5 memory append and graduation confirmation`。
- 核心上线闸口不变：仍需外部输入后运行 `release:validation-suite -- --evidence-out <sanitized-release-evidence-json>`。
