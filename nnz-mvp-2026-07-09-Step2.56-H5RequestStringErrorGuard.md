# nnz-mvp 2026-07-09 Step 2.56 H5 Request String Error Guard

## 背景

Step 2.53-2.55 已把 H5 主要 API 调用统一到 `h5Request()`，并为非 JSON 响应提供固定用户语言兜底。继续复核请求层时发现，HTTP 非 2xx 时会直接把 `data.error` 传给 `Error`。如果后端或代理返回对象、数组、空值等异常 error payload，用户侧可能看到 `[object Object]` 等非用户语言。

这个修复不改变 API contract，也不新增后端能力；它只收紧 H5 展示前的错误字符串边界。

## 本次变更

- `public/index.html` 中 `h5Request()` 仅允许非空字符串 `data.error` 进入 `Error`。
- `data.error` 为对象、数组、空字符串、null、undefined 等情况时，统一回退为 `请求失败。`。
- `src/h5-experience.test.ts` 增加静态回归，防止回退到 `throw new Error((data && data.error) || '请求失败。')`。

## 回归覆盖

- 后端正常字符串错误仍可由调用点继续通过 `h5SafeErrorMessage()` 过滤机制词。
- 异常 error payload 不再形成 `[object Object]` 等用户可见文案。
- 不改变 H5 登录、体验模式、创建、聊天、Covenant、导出或删除接口 payload。

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

- 本地 Step 2.56 已完成，尚待下一次合并 push。
- 最新已推送提交是 `e251fd3 fix: unify h5 covenant request handling`。
- 核心上线闸口不变：仍需外部输入后运行 `release:validation-suite -- --evidence-out <sanitized-release-evidence-json>`。
