# nnz-mvp 2026-07-09 Step 2.57 H5 Conversation DOM Rendering

## 背景

Step 2.52 已经把 persona 下拉框从 `innerHTML` 拼接改成 DOM text API，Step 2.53-2.56 又把 H5 请求错误兜底收紧。继续审计 H5 用户端时发现，对话区 `h5RenderConversation()` 和 `h5AppendBubble()` 仍通过 HTML 字符串渲染聊天气泡。

虽然旧实现对消息内容调用了 `escapeHtml(content)`，但聊天气泡是用户输入和助手回复的核心展示路径。为了降低未来维护时绕过 escape 的风险，本步骤把 H5 对话气泡改成 DOM 节点和 `textContent` 渲染。

## 本次变更

- `public/index.html` 新增 `h5CreateBubble(role, content, time)`，用 `document.createElement()` 和 `textContent` 创建气泡。
- `h5RenderConversation()` 清空消息容器后逐条 `appendChild(h5CreateBubble(...))`，不再用 `messages.map(...).join('')` 拼 `innerHTML`。
- `h5AppendBubble()` 不再使用 `insertAdjacentHTML()` 追加气泡。
- 空对话提示也复用 `h5CreateBubble('ASSISTANT', ...)`，避免在同一容器里保留另一套气泡字符串模板。
- `src/h5-experience.test.ts` 增加静态回归，固定 H5 对话气泡必须走 DOM text API。

## 回归覆盖

- 用户输入和助手回复内容进入 `textContent`，不会被当作 HTML 解析。
- 保留原有用户/助手气泡 class、换行展示和滚动到底部行为。
- 不改变 `/api/me/chat`、历史读取、Covenant、导出、删除或 scoped runtime 逻辑。
- 不改变 release validation 外部输入要求。

## 本地验证

```text
npm test -- h5-experience
1 passed; 15 passed

npm run typecheck
passed

npm test
34 passed | 2 skipped; 226 passed | 2 skipped

npm run build:demo
passed

git diff --check
passed
```

## 状态

- Step 2.57 本地已完成，尚待下一次合并 push。
- 最新已推送提交是 `63de393 docs: mark step 2.56 as pushed`。
- 核心上线闸口不变：仍需外部输入后运行 `release:validation-suite -- --evidence-out <sanitized-release-evidence-json>`。
