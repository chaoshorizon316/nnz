# nnz-mvp 2026-07-09 Step 2.54 H5 Guest Mode Unified Request

## 背景

Step 2.53 已经把 H5 通用请求层 `h5Request()` 改为 `response.text()` + 安全 `JSON.parse`，让非 JSON / 空响应收敛到用户语言错误。继续复核调用点时发现，`h5GuestMode()` 仍手写 `fetch('/api/register')` 和 `res.json()`，绕过了统一请求层。

这个修复不改变体验模式的功能、不改变 auth API，也不新增后端能力；它只是把体验模式注册纳入同一套 H5 请求与错误展示边界。

## 本次变更

- `public/index.html` 中 `h5GuestMode()` 改为调用 `h5Request('/api/register', { method: 'POST', body, skipAuth: true })`。
- 体验模式成功路径保持不变：写入 token、显示体验账号、进入创建流程。
- 失败路径改为 `h5SafeErrorMessage(error, '体验模式暂不可用')`。
- `src/h5-experience.test.ts` 增加静态回归：
  - 要求 `h5GuestMode()` 使用 `h5Request('/api/register')`。
  - 要求传入 `skipAuth: true`。
  - 禁止回退到 `fetch('/api/register')` 或 `await res.json()`。

## 回归覆盖

- 体验模式注册与常规注册共享同一套非 JSON 响应兜底。
- 体验模式错误展示继续走机制词过滤。
- 不改变用户登录、创建记忆伙伴、聊天、导出、删除或 Covenant 操作。

## 本地验证

```text
npm test -- h5-experience
1 passed; 14 passed

npm run typecheck
passed

npm test
34 passed | 2 skipped; 225 passed | 2 skipped

npm run build:demo
passed
```

## 状态

- 本地 Step 2.54 已完成，尚待下一次合并 push。
- 最新已推送提交是 `9619fb9 fix: handle h5 non-json responses safely`。
- 核心上线闸口不变：仍需外部输入后运行 `release:validation-suite -- --evidence-out <sanitized-release-evidence-json>`。
