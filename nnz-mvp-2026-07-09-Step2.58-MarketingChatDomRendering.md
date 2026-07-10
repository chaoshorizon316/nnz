# nnz-mvp 2026-07-09 Step 2.58 Marketing Chat DOM Rendering

## 背景

Step 2.57 已把 H5 登录态对话区改为 DOM `textContent` 渲染。继续审计 `public/index.html` 的用户端输入展示路径时发现，官网首页的在线咨询模拟聊天仍通过 `innerHTML` 拼接用户输入和模拟回复。

旧实现对用户内容调用了 `escapeHtml()`，但这条路径仍属于用户可输入内容进入 HTML 字符串。为了让用户端渲染策略一致，本步骤把官网咨询聊天也改为 DOM text API。

## 本次变更

- `public/index.html` 新增 `createMarketingChatBubble(role, content)`，用 `document.createElement()` 和 `textContent` 创建官网咨询气泡。
- `sendChat()` 追加用户消息和模拟回复时改为 `appendChild(createMarketingChatBubble(...))`。
- 模拟回复中的自定义角色名不再需要 `escapeHtml(roleVal)`，因为最终通过 `textContent` 渲染。
- 删除不再使用的 `escapeHtml()` helper。
- `src/h5-experience.test.ts` 增加静态回归，防止官网咨询聊天回退到 `innerHTML` 拼接。

## 回归覆盖

- 官网咨询里用户输入的角色、描述、消息只进入 `textContent`。
- 模拟回复仍保留原有用户/助手气泡样式和滚动到底部行为。
- 不改变 H5 登录态 `/api/me/*`、Covenant、导出、删除或 scoped runtime 逻辑。
- 不改变 release validation 外部输入要求。

## 本地验证

```text
npm test -- h5-experience
1 passed; 16 passed

npm run typecheck
passed

npm test
34 passed | 2 skipped; 227 passed | 2 skipped

npm run build:demo
passed
```

## 状态

- Step 2.58 本地已完成，尚待下一次合并 push。
- 最新已推送提交是 `3e7861e fix: render h5 conversation bubbles with DOM text APIs`。
- 核心上线闸口不变：仍需外部输入后运行 `release:validation-suite -- --evidence-out <sanitized-release-evidence-json>`。
