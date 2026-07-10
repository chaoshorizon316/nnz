# nnz-mvp 2026-07-10 Step 2.64 Public Pricing Dependency-Safe Copy

## 背景

Step 2.63 已把公开页定价 CTA 接入付费流程弹窗。继续按产品红线审计公开页时发现，定价区、付费流程弹窗和咨询区仍有一些容易制造依赖或暴露机制感的表达，例如“终身访问 / 永久使用 / 无限轮次 / AI复刻 / 记忆人格 / 塑造人格”等。

这些词不一定会导致功能错误，但与“帮助用户离开，而不是留下”的产品目标有张力，也容易让用户把服务理解成无限陪伴或人格复制。本步骤把它们改成更克制、用户能理解的表达，并把对应词加入前台可见文案与运行时错误过滤护栏。

## 本次变更

- 定价说明从“终身买断 / 长期守护”改为“长期纪念托管 / 持续维护记忆资料”。
- 标准版的“朋友圈可见”改为“纪念卡片”。
- 托管方案从“终身访问 / 一次性买断 / 永久使用 / 无限对话轮次 / 数据遗产移交”改为“纪念托管 / 一次性托管 / 长期保存 / 更高对话额度 / 数据档案移交”。
- 年卡说明从“12次重逢”改为“12个特别时刻”，弱化反复重逢暗示。
- FAQ 和咨询区把“人格档案 / 记忆人格 / 塑造人格 / AI复刻”改为“记忆档案 / 记忆伙伴资料 / 整理资料”。
- 付费流程弹窗中的方案名称和支付二维码展示同步改为“纪念卡片 / 纪念托管”。
- `USER_VISIBLE_MECHANISM_TERMS` 和 `H5_UNSAFE_ERROR_FRAGMENTS` 补齐上述依赖诱导或机制化表达，后续进入可见文案或运行时错误都会被测试/过滤拦截。

## 回归覆盖

- 三档定价仍保留原价格、CTA、方案绑定和支付流程。
- `selectedPlan` 内部值仍保持 `light` / `standard` / `lifetime`，不改变付费流程状态逻辑。
- H5 在线体验、官网咨询聊天、导出、删除、Covenant 操作不变。
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

rg -n '终身访问|终身版|永久使用|无限轮次|无限对话|永生AI|无限陪伴|AI复刻|记忆人格|塑造人格|人格档案|朋友圈可见|买断|复刻|长期守护|数据遗产' nnz-mvp/public/index.html
only matches are inside `H5_UNSAFE_ERROR_FRAGMENTS`
```

## 状态

- Step 2.64 已完成、验证并推送。
- 推送提交是 `92440b0 fix: soften public pricing dependency copy`。
- 核心上线闸口不变：仍需外部输入后运行 `release:validation-suite -- --evidence-out <sanitized-release-evidence-json>`。
