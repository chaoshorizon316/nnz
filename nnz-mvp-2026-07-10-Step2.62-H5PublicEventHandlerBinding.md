# nnz-mvp 2026-07-10 Step 2.62 H5 Public Event Handler Binding

## 背景

Step 2.57-2.61 已把 H5 对话气泡、官网咨询聊天、H5 创建选项、生命周期操作区、等待回复气泡逐步改为 DOM `textContent` 渲染。继续审计 `public/index.html` 时发现，用户前台仍保留大量 inline `onclick` / `onchange` / `oninput` / `onkeydown` 事件属性。

这些事件属性主要分布在三块：H5 在线体验弹窗、官网咨询聊天、付费流程弹窗。它们当前不是直接拼接用户内容，但仍让模板承担行为绑定职责，也让后续安全扫描难以区分静态 UI 与动态逻辑。本步骤按用户希望“合并一个大版本进行推送”的节奏，把这些前台 inline 事件一次性迁到 JS 事件绑定。

## 本次变更

- `public/index.html` 用户前台移除 inline `onclick` / `onchange` / `oninput` / `onkeydown`。
- H5 在线体验弹窗按钮改为 `data-action` 标记，通过 `bindPublicInteractionHandlers()` 和 `handlePublicAction()` 统一绑定。
- H5 persona switcher、聊天输入 Enter 发送、记忆/封存/特别时刻/毕业确认按钮均从 inline 事件迁到 JS listener。
- 官网咨询聊天的角色快捷按钮改为 `data-role`，发送按钮改为 `data-action="send-marketing-chat"`，自定义角色输入和 Enter 发送改为 JS listener。
- 付费流程弹窗的方案卡改为 `data-plan`，流程按钮改为 `data-action` + `data-step`，遮罩点击关闭改为 JS listener。
- `selectPlan()` 同步更新 radio checked 状态，避免迁出 label inline 后只更新视觉样式。
- `src/h5-experience.test.ts` 新增前台 inline event attribute guard，禁止 `public/index.html` 再出现 inline `on*=` 事件属性。

## 回归覆盖

- 导航、Hero、价值区 CTA 仍打开 H5 在线体验弹窗。
- H5 登录、注册、体验模式、导出、删除确认、新建 persona、补充记忆、封存确认、特别时刻完成、毕业确认、发送消息仍绑定原业务函数。
- 官网咨询聊天的角色标签、自定义输入、回车发送和发送按钮仍绑定原业务函数。
- 付费流程弹窗的步骤切换、方案选择、支付二维码、模拟支付和完成/关闭仍绑定原业务函数。
- 不改变聊天 API、Covenant 状态、scoped runtime、导出、删除或 release validation 入口。

## 本地验证

```text
npm test -- h5-experience
1 passed; 20 passed

npm run typecheck
passed

npm test
34 passed | 2 skipped; 231 passed | 2 skipped

npm run build:demo
passed

NNZ_DB_PATH=/tmp/nnz-step262-smoke.db node dist-cjs/demo-server.js
server started on http://127.0.0.1:3007

curl -fsS http://127.0.0.1:3007/
confirmed data-action/data-role/data-plan markers in served homepage

curl -fsS http://127.0.0.1:3007/ | rg -n 'onclick=|onchange=|oninput=|onkeydown='
no matches

curl -fsS http://127.0.0.1:3007/healthz
ok; fixture sqlite; runtimeMode snapshot
```

说明：本地 server 监听端口和本机 curl 访问需要提升权限才能绕过当前 Codex 沙盒的端口/network 限制；验证使用 `/tmp/nnz-step262-smoke.db`，没有使用真实用户数据库路径。

## 状态

- Step 2.62 已完成并推送。
- 最新已推送提交是 `18641cd fix: bind public page interactions without inline handlers`。
- 核心上线闸口不变：仍需外部输入后运行 `release:validation-suite -- --evidence-out <sanitized-release-evidence-json>`。
