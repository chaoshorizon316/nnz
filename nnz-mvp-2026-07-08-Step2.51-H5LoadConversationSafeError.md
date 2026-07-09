# nnz-mvp 2026-07-08 Step 2.51 H5 Load Conversation Safe Error

## 背景

Step 2.48-2.50 已经把 H5 主要运行时错误展示点统一接到 `h5SafeErrorMessage()`，并让运行时 unsafe fragments 与可见文案禁用词保持一致。继续复核 H5 调用链时发现，`h5LoadConversation()` 直接 `await h5Request('/api/me/chat-history?...')`，如果 persona 切换或 Covenant 操作后的历史刷新失败，错误可能向上冒泡，缺少就地用户语言兜底。

这个问题不改变数据作用域，也不新增后端能力；它属于 H5 展示层的安全错误处理补齐。

## 本次变更

- `public/index.html` 中 `h5LoadConversation()` 增加 `try/catch`。
- 对话历史读取失败时，通过 `h5SetStatus('h5PersonaStatus', h5SafeErrorMessage(error, '读取对话失败，请稍后再试。'))` 展示用户语言。
- `src/h5-experience.test.ts` 的 H5 runtime error sanitization 测试覆盖 `h5LoadConversation()`，防止该路径后续回退为 raw error。

## 回归覆盖

- H5 对话历史刷新失败不会暴露 raw backend error。
- persona 切换、Covenant 操作后调用 `h5LoadConversation()` 的路径获得同一套安全错误展示兜底。
- 不改变 `userId + personaId` 作用域边界，不新增 migration 或外部 DB 依赖。

## 本地验证

```text
npm test -- h5-experience
passed

npm run typecheck
passed

npm test
34 passed | 2 skipped; 224 passed | 2 skipped

npm run build:demo
passed
```

## 状态

- Step 2.51 已完成并推送为 `58c0fe5 fix: handle h5 conversation load errors safely`。
- 最新本地后续是 Step 2.52 H5 persona switcher safe rendering。
- 核心上线闸口不变：仍需外部输入后运行 `release:validation-suite -- --evidence-out <sanitized-release-evidence-json>`。
