# nnz-mvp 2026-07-09 Step 2.55 H5 Covenant Unified Request

## 背景

Step 2.53-2.54 已经把 H5 通用请求层和体验模式注册统一到 `h5Request()`。继续复核 H5 API 调用时发现，Covenant 状态刷新和封存/开启/完成动作仍手写 `fetch()` 与 `res.json()`，绕过了请求层的非 JSON 响应兜底。

这个修复不改变 Covenant 状态机、不改变后端接口，也不新增数据迁移；它只让 H5 Covenant 调用共享同一套请求与错误展示边界。

## 本次变更

- `public/index.html` 中 `h5RefreshCovenantState()` 改为调用 `h5Request('/api/me/covenant-state?...')`。
- `public/index.html` 中 `h5CovenantAction()` 改为调用 `h5Request(url, { method: 'POST', body })`。
- Covenant 动作失败时统一走 `h5SafeErrorMessage(error, '刚才没有完成，请稍后再试。')`。
- `src/h5-experience.test.ts` 增加静态回归，要求 Covenant 状态刷新和动作提交使用 `h5Request()`，并禁止回退到 fetch / `res.json()`。

## 回归覆盖

- 封存、开启特别时刻、完成特别时刻共享非 JSON 响应兜底。
- Covenant 后端错误继续通过 `h5SafeErrorMessage()` 过滤机制词。
- Covenant 状态刷新失败仍保持静默，不向用户暴露技术细节。

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

- Step 2.55 已完成并推送为 `e251fd3 fix: unify h5 covenant request handling`。
- 最新本地后续是 Step 2.56 H5 request string error guard。
- 核心上线闸口不变：仍需外部输入后运行 `release:validation-suite -- --evidence-out <sanitized-release-evidence-json>`。
