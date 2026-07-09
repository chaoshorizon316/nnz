# nnz-mvp 2026-07-09 Step 2.53 H5 Request Non-JSON Safe Fallback

## 背景

Step 2.48-2.52 已经把 H5 用户可见错误和若干用户输入渲染路径收紧。继续复核请求层时发现，`h5Request()` 直接调用 `response.json()`。如果网关、静态错误页或空响应返回非 JSON 内容，浏览器会抛出解析异常；这些异常再由调用点展示时，可能变成技术化错误文案。

这个修复不改变 API contract、不改变数据作用域，也不新增外部依赖；它只让 H5 请求层在异常响应形态下保持用户语言。

## 本次变更

- `public/index.html` 中 `h5Request()` 改为先读取 `response.text()`。
- 对响应正文执行安全 `JSON.parse`，空响应按 `{}` 处理。
- 解析失败时抛出固定 `请求失败。`，避免 raw JSON parse error 进入用户可见路径。
- HTTP 非 2xx 时仍优先使用后端 `data.error`，并继续由调用点的 `h5SafeErrorMessage()` 做机制词过滤。
- `src/h5-experience.test.ts` 增加静态回归，要求 `h5Request()` 使用 `response.text()` + `JSON.parse(rawBody)`，并禁止回退到 `await response.json()`。

## 回归覆盖

- 非 JSON / 空响应不会产生技术化解析错误。
- 既有 H5 API 调用路径仍通过同一个 `h5Request()` 返回 JSON 数据。
- 不改变登录、创建、导出、删除、补充记忆、读取对话、毕业或聊天接口的 payload。

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

- 本地 Step 2.53 已完成，尚待下一次合并 push。
- 最新已推送提交是 `0e9ffee fix: render h5 persona switcher safely`。
- 核心上线闸口不变：仍需外部输入后运行 `release:validation-suite -- --evidence-out <sanitized-release-evidence-json>`。
