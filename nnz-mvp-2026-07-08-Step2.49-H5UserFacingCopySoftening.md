# nnz-mvp 2026-07-08 Step 2.49 H5 User-Facing Copy Softening

## 背景

Step 2.47/2.48 已经分别覆盖 H5 静态可见文案与运行时错误展示的机制泄露风险。继续审阅首页与 H5 体验周边文案时，仍看到若干偏系统化的用户可见词，例如“节点重启”“AI人格”“毕业机制”。

这些词不直接破坏后端边界，但会让用户感觉自己在读产品机制说明，而不是在理解一段可选择、可退出的哀伤陪伴体验。

## 本次变更

- 将“节点重启”改为“特别时刻”或“重要时刻”。
- 将“AI人格 / 基础 AI 人格”改为“记忆伙伴 / 基础记忆伙伴”。
- 将“毕业机制”改为“主动告别”或“毕业的出口”。
- 将“节点卡片 / 节点解锁 / 12节点 / 无节点限制”等计费与功能描述改为“时刻卡片 / 特别时刻 / 次数”。
- 将演示聊天中的“AI人格核心种子 / 塑造 AI 人格”改为“记忆伙伴”。
- 将这些词加入 H5 visible mechanism leak guard 的禁用清单，避免后续前台文案回退。

## 回归覆盖

- `src/h5-experience.test.ts` 的 visible copy guard 新增：
  - `AI人格`
  - `基础 AI 人格`
  - `基础AI人格`
  - `毕业机制`
  - `节点重启`

## 本地验证

```text
npm test -- h5-experience
1 passed; 13 passed

npm run typecheck
passed

npm test
34 passed | 2 skipped; 224 passed | 2 skipped

npm run build:demo
passed
```

## 状态

- Step 2.49 已完成，并与 Step 2.48 合并推送为 `ca296ca fix: sanitize h5 runtime errors and soften copy`。
- 最新本地后续是 Step 2.50 H5 runtime unsafe fragment parity。
- 核心上线闸口不变：仍需外部输入后运行 `release:validation-suite -- --evidence-out <sanitized-release-evidence-json>`。
