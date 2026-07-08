# nnz-mvp 2026-07-08 Step 2.47 H5 Visible Mechanism Leak Guard

## 背景

Step 2.46 推送后，H5 的关键确认面板已经收束成互斥交互。继续做上线前用户端完整度检查时，需要把“机制不外露”从零散人工审阅变成可回归的静态护栏。

本阶段不改变后端 scope、Covenant 状态机、migration/release CLI，也不新增外部验证入口。

## 本次变更

- `src/h5-experience.test.ts` 新增 H5 用户可见文案扫描：
  - 剥离 `script`、`style`、HTML comment 后扫描正文。
  - 同时扫描 `aria-label`、`alt`、`placeholder`、`title`、`value` 等常见可见属性。
  - 避免把 JS 里的 `personaId` / `Covenant` 变量名误判成用户可见文案。
- 机制词清单覆盖：
  - `SoulVersion`、`SoulSnapshot`、`SoulUpdateProposal`、`MemoryItem`。
  - `userId`、`personaId`、`scope`、`kernelJson`、`vector`、`embedding`、`LLM prompt`。
  - raw lifecycle names：`ACTIVE`、`SEALED`、`NODE`、`GRADUATED`。
  - 中文机制表达：`作用域`、`检索`、`证据`、`节点里的`、`不是我本来就知道`、`只按`、`别人的记忆`。
  - 前台不应出现的运营/模型表达：`后台通知`、`人工审核`、`极端情绪词汇`、`AI模型`。
- `public/index.html` 安全与付费卡片文案改成用户语言：
  - “情绪监测与危机干预”改为“危机时优先连接现实支持”。
  - 移除“后台通知人工审核”“识别极端情绪词汇”。
  - 移除“AI模型的持续训练成本”和“导出 AI 模型”，改成稳定服务、安全加密保存、数据档案。

## 回归覆盖

- `src/h5-experience.test.ts` 新增 `does not expose internal mechanism terms in user-visible H5 copy`。
- 该测试会在静态页面层阻止内部机制词回到用户可见文案。
- 既有动态 lifecycle raw state fallback 测试仍保留，继续覆盖 `badge.textContent = labels[state] || state` 这类回退风险。

## 本地验证

```text
npm test -- h5-experience
1 passed; 12 passed

npm run typecheck
passed

npm test
34 passed | 2 skipped; 223 passed | 2 skipped

npm run build:demo
passed
```

## 状态

- Step 2.47 已完成并推送为 `0d78c32 test: guard h5 visible copy against mechanism leaks`。
- 最新本地后续是 Step 2.48 H5 runtime safe error guard。
- 核心上线闸口不变：仍需外部输入后运行 `release:validation-suite -- --evidence-out <sanitized-release-evidence-json>`。
