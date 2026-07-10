# nnz-mvp 2026-07-10 Step 2.65 Public Footer Compliance Links

## 背景

Step 2.64 已把公开页定价和付费流程文案从依赖诱导表达中收回来。继续做发布前前台收口时发现，公开页页脚的“用户协议 / 隐私政策 / 伦理承诺”仍是 `href="#"` 空链接。

这不影响后端功能，但会影响上线前可信度，也会让用户在数据权利和伦理边界上点不到明确说明。本步骤不新增转化功能，只把页脚合规入口补成真实可达的同页锚点，并用 H5 静态测试防止空链接回归。

## 本次变更

- 在公开页 CTA 与页脚之间新增轻量“合规与承诺”说明区。
- 新增 `#terms`、`#privacy`、`#ethics` 三个可见锚点，分别对应用户协议摘要、隐私政策摘要和伦理承诺摘要。
- 页脚“用户协议 / 隐私政策 / 伦理承诺”从 `href="#"` 改为对应真实锚点。
- 合规说明强调用户可暂停、导出、删除数据，不以连续签到、限时权益或高频奖励推动停留。
- `h5-experience` 静态测试新增 `href="#"` 禁止回归检查，并断言所有 `#xxx` 链接都能落到真实 `id`，页脚三项能落到可见合规说明。

## 回归覆盖

- 不改变 H5 体验弹窗、聊天 API、付费流程弹窗或定价方案状态。
- 不改变 scoped runtime、Covenant、导出、删除或 release validation 入口。
- 公开页仍是单页滚动结构，新增合规区和锚点完整性测试只服务发布前可信度和数据权利说明。

## 本地验证

```text
npm test -- h5-experience
1 passed; 21 passed

npm run typecheck
passed

npm test
34 passed | 2 skipped; 232 passed | 2 skipped

npm run build:demo
passed

git diff --check
passed

rg -n 'href="#"|终身访问|终身版|永久使用|无限轮次|无限对话|永生AI|无限陪伴|AI复刻|记忆人格|塑造人格|人格档案|朋友圈可见|买断|复刻|长期守护|数据遗产' public/index.html src/h5-experience.test.ts
only matches are inside guard arrays
```

## 状态

- Step 2.65 本地已完成，尚待下一次合并 push。
- 最新已推送提交是 `92440b0 fix: soften public pricing dependency copy`。
- 本地可控的前台收口预计只剩 0-1 个小检查版本；真正上线放行仍取决于外部输入齐备后的 `release:validation-suite -- --evidence-out <sanitized-release-evidence-json>`。
