# nnz-mvp 2026-07-10 Step 2.63 Public Pricing CTA Flow Binding

## 背景

Step 2.62 已把 `public/index.html` 用户前台的 inline 事件属性收口为 `data-action` / `data-role` / `data-plan` + JS 事件绑定。继续检查前台转化链路时发现，页面中已经存在完整的 `flowOverlay` 付费流程弹窗和 `openFlow()` / `showPaymentQR()` / `selectPlan()` 逻辑，但定价区三张方案卡片仍只链接到在线咨询区 `#cta`。

这意味着用户在定价区点击“免费体验首月 / 了解详情”时不会进入付费流程，而是滚到咨询聊天。为了让已有付费流程真正可达，本步骤把三张方案卡片接入流程弹窗，并按点击的方案预选对应计划。

## 本次变更

- 轻量版 CTA 改为 `data-action="open-flow"` + `data-flow-plan="light"` + `data-flow-step="2"`。
- 标准版 CTA 改为 `data-action="open-flow"` + `data-flow-plan="standard"` + `data-flow-step="2"`。
- 终身访问 CTA 改为 `data-action="open-flow"` + `data-flow-plan="lifetime"` + `data-flow-step="2"`。
- `handlePublicAction()` 新增 `open-flow` 分支，复用已有事件绑定机制。
- `openFlow(plan = selectedPlan, step = 1)` 支持指定方案和初始步骤，打开弹窗后直接定位到方案选择页。
- `src/h5-experience.test.ts` 补充静态回归，禁止定价 CTA 回退到 `href="#cta"`，并校验三种方案标记和 `openFlow()` 预选逻辑。

## 回归覆盖

- 定价区三张方案卡片点击后进入付费流程弹窗，而不是跳到在线咨询区。
- 流程弹窗仍保留原有 Step 1 / Step 2 / Step 3、方案选择、支付二维码、模拟支付和二维码倒计时逻辑。
- 方案卡片点击会预选对应 light / standard / lifetime 计划。
- 首页在线体验 CTA、H5 对话、官网咨询聊天、Covenant 操作、导出、删除等既有前台交互不变。
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

rg -n 'href="#cta"|onclick=|onchange=|oninput=|onkeydown=' nnz-mvp/public/index.html
no matches

rg -n 'href="#cta"|onclick=|onchange=|oninput=|onkeydown=' nnz-mvp/dist-cjs/public/index.html
no matches

rg -n 'data-action="open-flow"|data-flow-plan="light"|data-flow-plan="standard"|data-flow-plan="lifetime"|function openFlow\(plan = selectedPlan, step = 1\)' nnz-mvp/dist-cjs/public/index.html
confirmed

git diff --check
passed
```

## 状态

- Step 2.63 已完成并推送。
- 最新已推送提交是 `8c12c99 fix: connect pricing CTAs to payment flow`。
- 核心上线闸口不变：仍需外部输入后运行 `release:validation-suite -- --evidence-out <sanitized-release-evidence-json>`。
