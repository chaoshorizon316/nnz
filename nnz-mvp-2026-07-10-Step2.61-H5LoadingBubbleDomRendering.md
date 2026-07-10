# nnz-mvp 2026-07-10 Step 2.61 H5 Loading Bubble DOM Rendering

## 背景

Step 2.57-2.60 已把 H5 对话气泡、官网在线咨询、H5 创建选项、生命周期操作区逐步改成 DOM `textContent` 渲染。继续审计 H5 对话容器时发现，发送消息后的“正在回复……”等待气泡仍由 `h5AppendLoading()` 通过 `insertAdjacentHTML` 拼接。

当前等待气泡文本是固定文案，但它位于 `h5Messages` 对话容器中，和用户输入、助手回复共享同一可见区域。为了让 H5 对话容器保持统一的非字符串 HTML 渲染策略，本步骤把 loading bubble 也改为 DOM 节点创建。

## 本次变更

- `h5AppendLoading()` 改为 `container.appendChild(h5CreateLoadingBubble())`。
- 新增 `h5CreateLoadingBubble()`，用 `document.createElement()` 创建 wrapper、width、bubble 和文案节点。
- “正在回复……”通过 `loadingText.textContent` 写入，不再进入 HTML 字符串。
- `src/h5-experience.test.ts` 新增 loading bubble DOM rendering 静态回归，禁止 `h5AppendLoading()` 回到 `insertAdjacentHTML`。

## 回归覆盖

- 发送消息时仍会追加 `id="h5Loading"` 的等待气泡。
- 等待气泡样式、宽度和文案保持不变。
- `h5RemoveLoading()` 仍通过 `id="h5Loading"` 移除等待气泡。
- 不改变聊天 API、Covenant 状态、scoped runtime、导出、删除或 release validation 入口。

## 本地验证

```text
npm test -- h5-experience
1 passed; 19 passed

npm run typecheck
passed

npm test
34 passed | 2 skipped; 230 passed | 2 skipped

npm run build:demo
passed

git diff --check
passed
```

## 状态

- Step 2.61 已完成并推送。
- 最新已推送提交是 `4e00c24 fix: render h5 loading bubble with DOM text APIs`。
- 核心上线闸口不变：仍需外部输入后运行 `release:validation-suite -- --evidence-out <sanitized-release-evidence-json>`。
