# nnz-mvp 安全护栏 — 实施记录

> 日期：2026-06-03
> 基于：PRD §3.3（健康使用限制）、Soul.md §5（底线防护栏）、商业化伦理框架 §1

## 为什么先做安全护栏

对照原始文档（PRD / Soul.md / 商业化伦理框架），当前代码在以下方面是空白：

1. **极端情绪检测** — PRD 规定检测到「活不下去」「想去找你」等必须自动回复心理援助热线
2. **禁止特定互动类型** — PRD 禁止占卜式咨询和模拟亲密伴侣行为
3. **每日消息限额** — 基础版 50 条/天，超出后提示休息
4. **知识截止日期** — Soul.md 规定 AI 知识截止于逝者去世日

这些不是"锦上添花"，而是和 Soul 作用域隔离同级别的底线设计。Soul.md 开篇第一句：「核心原则：全自动、可解释、用户可控、伦理底线硬编码、禁止拟人化诱导」。

## 实施内容

### 1. 类型扩展

- `SoulVersion` 新增 `knowledgeCutoff?: Date` — 知识截止日期（供 LLM 层使用）
- `RuntimeSession` 新增 `dailyMessageCount?: number` + `lastMessageDate?: string` — 每日计数器

### 2. 安全护栏模块（`src/runtime/soul-guard.ts`）

独立的纯函数模块，不依赖 store，方便测试和替换：

| 函数 | 职责 |
|:---|:---|
| `checkMessageSafety(message)` | 极端情绪 / 占卜 / 亲密边界 三重检测，命中任一项即阻断 |
| `checkDailyLimit(session, limit?)` | 检查当天消息数是否达限（跨天自动重置） |
| `incrementDailyCount(session)` | 递增当日计数（跨天自动重置为 1） |
| `maybeDependencyReminder(session)` | 当日计数 ≥7 时插入现实社交提醒 |

**风险短语**：`活不下去 / 想去找你 / 想死 / 不想活 / 活够了 / 没有意义 / 陪你去 / 跟你走`
**占卜模式**：`我该不该 / 要不要.*辞职 / 要不要.*离婚 / 要不要.*分手 / 你告诉我.*怎么办 / 帮.*做决定`
**亲密边界**：`抱抱我 / 亲我 / 想.*抱着 / 陪我睡`

触发极端情绪时，除了返回安全回复，demo server 还会自动写入一条 `RISK` 类型 Memory。

### 3. Store 适配

- `getRuntimeSession` 默认返回含计数器的 session 并存入 Map（确保跨请求持久）
- 所有 covenant 方法（seal/activateNode/completeNode/graduate）创建的 session 继承当前计数器

### 4. Demo Server 集成

`sendMessageToBothUsers` 在生成回复前先过安全护栏：
1. `checkMessageSafety` → 阻断则直接返回安全回复 + 写 RISK memory
2. `checkDailyLimit` → 达限则返回休息提示
3. 通过 → `incrementDailyCount` → 正常生成回复

## 测试覆盖

37 条测试，新增 14 条 soul-guard 测试：

- 4 条极端情绪检测（多短语覆盖）
- 1 条占卜式咨询阻断
- 1 条亲密边界阻断
- 2 条正常消息通过
- 4 条每日限额（限额内/达限/跨天重置/递增）
- 1 条依赖提醒（7天阈值）

## 手动验证

- 极端情绪 → 返回 `心理援助热线：400-161-9995（24小时）...` ✅
- 占卜咨询 → 返回 `如果是他还在，他会尊重你自己的选择...` ✅
- 52 条消息 → 第 51 条起返回 `今天聊得够多了...` ✅

## 未实施的安全项（留给后续或 LLM 层）

以下在 Soul.md 中已定义，但当前 deterministic runtime 无法合理实现，标注为 LLM 层职责：

- **「如果我还活着」句式** — 需要 LLM 理解消息是否提到了逝者去世后的事件
- **连续使用 30 天强制降额** — 需要持久化存储和定时检查
- **禁止模拟强烈性暗示** — 文本边界检测已覆盖常见模式，更细粒度需 LLM 内容审核

## 与其他模块的关系

```
用户消息
  ↓
demo-server sendMessageToBothUsers()
  ↓
applySafetyGuard()  ←── soul-guard.ts（checkMessageSafety + checkDailyLimit）
  ↓ 通过
getRuntimeContext()  ←── soul-store.ts（按 covenant 状态组装 soul+memories）
  ↓
generateSoulReply()  ←── soul-runtime.ts（纯函数，不感知安全和 covenant）
  ↓
回复
```

安全护栏在 runtime 之前执行，被打断的消息不会进入 runtime。这保持了 runtime 的纯净性。

## 关键设计决策

1. **护栏是纯函数模块，不注入 store** — 方便单独测试和未来替换（如 LLM 输出审核替换文本匹配）
2. **知识截止日期字段已加但未强制** — 字段存在供 LLM 层读取；当前 runtime 不检查（无法判断消息是否涉及新事件）
3. **每日限额计数器存在 RuntimeSession 中** — 进程重启丢失（MVP 设计，生产需持久化）
