# nnz-mvp 当前状态与交接指南

> 更新：2026-06-03
> 覆盖：Step 1（Covenant 状态机）→ Step 4.5（Memory 分层 + Maturity）→ 安全护栏

## 一句话定位

这是「念念在」产品的 MVP Core——验证 Soul 作用域隔离、完整流转（封存/节点/毕业）、Memory 分层、Soul 成熟度评估、伦理安全护栏。**不是完整聊天产品，是领域模型的可靠地基。**

## 架构总览

```
src/
├── domain/
│   ├── types.ts          — 全部类型定义（User, Soul, Memory, Session, Maturity…）
│   ├── errors.ts         — ScopeValidationError, NotFoundError, OwnershipError, CovenantStateError
│   ├── soul-store.ts     — InMemorySoulStore：作用域隔离 + covenant 状态机 + memory 分层 + maturity
│   ├── soul-scope.test.ts — 19 条 domain 测试
│   └── index.ts          — re-export barrel
├── runtime/
│   ├── soul-runtime.ts   — generateSoulReply() 纯函数（intent 识别 + 回复生成 + 机制词防漏）
│   ├── soul-guard.ts     — 安全护栏（极端情绪检测 / 占卜拒绝 / 每日限额 / 依赖提醒）
│   ├── soul-runtime.test.ts — 4 条 runtime 测试
│   └── soul-guard.test.ts   — 14 条 guard 测试
└── demo-server.ts        — 本地 HTTP 服务（A/B 双用户演示 + API + UI）
```

## 领域模型核心规则

### 第一原则：Soul 是关系性的，不是全局的

```
所有 Soul / Memory / Snapshot / Node / Conversation 访问必须同时带 userId + personaId
禁止：只按 personaId 查询、全局 DeceasedSoul、跨用户聚合
```

### 第二原则：伦理是硬编码的，不可绕过

- 极端情绪 → 自动阻断 + 返回心理援助热线
- 占卜式咨询（"我该不该"）→ 拒绝 + 引导自主决策
- 每日消息限额（默认 50 条）→ 超出后提示休息
- 机制词不允许进入 AI 前台回复

## 关键文件与职责

| 文件 | 代码量 | 职责 | 关键方法 |
|:---|:---|:---|:---|
| `types.ts` | ~170 行 | 所有类型 | SoulVersion, MemoryItem（13字段）, RuntimeSession, SoulMaturityReport |
| `soul-store.ts` | ~850 行 | 核心引擎 | sealSoul, activateNode, completeNode, graduateSoul, getRuntimeContext, buildSoulMaturityReport, listRuntimeMemory, listSoulUpdateMemory |
| `soul-runtime.ts` | ~150 行 | 回复生成 | generateSoulReply(soul, memories, message) → SoulReply |
| `soul-guard.ts` | ~120 行 | 安全护栏 | checkMessageSafety, checkDailyLimit, incrementDailyCount |
| `demo-server.ts` | ~850 行 | 演示服务 | 14 个 API 端点 + 完整 HTML UI |

## Covenant 状态机

```
ACTIVE ──sealSoul()──→ SEALED ──activateNode()──→ NODE ──completeNode()──→ SEALED
  │                       │                            │
  └──graduateSoul()──→ GRADUATED                       └──graduateSoul()──→ GRADUATED
```

- **ACTIVE**：正常聊天，使用当前 Soul + listRuntimeMemory()
- **SEALED**：静默，getRuntimeContext 抛 CovenantStateError，demo 层返回封存提示
- **NODE**：从 snapshot 临时重建 Soul + 该 scope 的 NODE_MEMORY
- **GRADUATED**：永久静默，所有 SoulVersion 标为 GRADUATED

## Memory Vault 分层

每条 MemoryItem 有 13 个字段，关键的分层控制：

- `enabledForRuntime` — 是否进入对话上下文（RISK 默认 false）
- `enabledForSoulUpdate` — 是否可作为 Soul 更新证据（NODE_MEMORY 和 RISK 默认 false）
- `sensitivity` — LOW/MEDIUM/HIGH/RESTRICTED（RESTRICTED 不进 runtime 也不进 soulUpdate）
- `source` — USER_INPUT/UPLOAD/CONVERSATION/CORRECTION/NODE/SYSTEM

查询方法：
- `listMemory(scope)` — 原始全量
- `listRuntimeMemory(scope)` — 过滤 state=ACTIVE + enabledForRuntime + !RISK + !RESTRICTED
- `listSoulUpdateMemory(scope)` — 过滤 state=ACTIVE + enabledForSoulUpdate + !NODE_MEMORY + !RISK + !RESTRICTED

## Soul Maturity 评估

`buildSoulMaturityReport(scope)` 按六维加权计算 0-100 分：

1. evidenceCoverage（25%）— Memory 数量、类型多样性、对话量
2. identityClarity（15%）— kernelJson 完整性
3. voiceConsistency（15%）— 口头禅、幽默度是否稳定
4. memoryReliability（15%）— 平均置信度、是否有高危记忆
5. runtimeStability（15%）— 对话量、pending proposal 数量
6. safetyReadiness（15%）— 风险记忆、对话负载

映射到 L0_SEED → L5_LEGACY_READY 六个等级，自动生成 SoulRecommendation[]。

## API 端点总览

```
GET  /                        — 演示页面
GET  /api/state               — 完整 A/B fixture（含 session、maturity report）
GET  /api/verification        — PASS/WAIT 检查
POST /api/chat                — 发送消息（含安全护栏）
POST /api/run-all             — 一键验证（纠正 + 节点）
POST /api/apply-correction    — 创建纠正 proposal
POST /api/accept-correction   — 接受纠正
POST /api/reject-correction   — 拒绝纠正
POST /api/create-node         — 创建婚礼节点
POST /api/seal                — 封存用户 A
POST /api/activate-node       — 节点重启用户 A
POST /api/complete-node       — 完成节点
POST /api/graduate            — 用户 A 毕业
POST /api/reset               — 重置演示
```

## 测试覆盖

**37 条测试全部通过**（typecheck + build 也通过）：

- `soul-scope.test.ts` — 19 条：作用域隔离（6）、covenant 流转（5）、memory 分层（3）、proposal 审核（3）、maturity（1）、单 ACTIVE Soul（1）
- `soul-runtime.test.ts` — 4 条：回复差异、机制词防漏、node context 区分
- `soul-guard.test.ts` — 14 条：极端情绪（4）、占卜（1）、亲密边界（1）、正常通过（2）、每日限额（4）、依赖提醒（1）、常量无泄漏（1）

## 下一步：推荐推进顺序

### 优先：真实 LLM 接入（Step 5）

当前 `generateSoulReply` 是确定性的——基于 intent 检测返回硬编码文案。接入真实 LLM 时：

1. 保留 `generateSoulReply` 的接口签名 `(soul, memories, message)`
2. 内部改为构建 system prompt（从 soul.kernelJson + memories）+ 调用 LLM API
3. 保留 `containsMechanismLeak` 检查作为输出 guard
4. 新增 `knowledgeCutoff` 检查——如果消息提及 cutoff 后事件，提示 LLM 用「如果我还活着」句式
5. `soul-guard` 继续在调用方（demo server）执行，不进入 LLM prompt

### 其次：自动化 Memory 提取管线（Soul.md §3）

Soul.md 设计了一套完整的自动化流程：聊天记录 → 特征提取 → 置信度计算 → Proposal 生成。当前 Memory 体系和 Proposal 审核流已经就位，缺的是从对话到提取的管线。核心是在 `addConversation` 之后触发一次 LLM 调用做结构化提取。

### 再次：持久化

当前全内存 store，进程重启数据丢失。在 LLM 接入前或同时，考虑 SQLite 持久化。`InMemorySoulStore` 的接口已足够清晰，可提取 interface 后做 `SqliteSoulStore` 实现。

## 不要破坏的点

1. **Soul 作用域规则** — userId+personaId 是最高优先级边界
2. **机制词防泄漏** — AI 角色不能自曝后台术语
3. **安全护栏** — 极端情绪检测和每日限额不可绕过
4. **Covenant 状态流转** — SEALED/NODE/GRADUATED 的行为差异已被测试锁定
5. **exactOptionalPropertyTypes** — TypeScript 非常严格，可选字段不能显式传 undefined
6. **dist-cjs/package.json** — 必须保留 `{"type": "commonjs"}`，否则 demo 无法启动


---

## 最新决策（2026-06-03）

经过对照原始 PRD 和 Soul.md 的缺口审查，决定下一步优先做**自动化提取管线**。

详细交接文档：`nnz-mvp-自动化提取管线-交接文档.md`

核心结论：
1. 提取管线必须先接通 LLM（因为需要 LLM 理解对话并结构化输出）
2. 需要编排——不能每条消息调一次 LLM，要处理触发时机、去重、置信度合并、阈值门控
3. LLM adapter 推荐用薄封装（~60 行），不引入 LangChain
4. 新代码集中在 `src/llm/` 和 `src/extraction/` 两个目录，不修改现有核心模块
