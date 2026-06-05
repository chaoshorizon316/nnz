# nnz-mvp 当前状态与交接指南

> 更新：2026-06-05
> 覆盖：Soul 作用域、Covenant 状态机、Memory 分层、Soul Ops、安全护栏、Render demo、LLM 对话、自动化提取管线

## 2026-06-05 GitHub / CI 状态

GitHub 仓库已经建立：

```text
https://github.com/chaoshorizon316/nnz
```

当前远端 `main`：

```text
ef2b364 feat: add llm prompt contract guards
```

本地状态：

```text
main...origin/main
```

GitHub Actions：

```text
NNZ MVP CI: success
```

CI 内容：

```bash
cd nnz-mvp
npm ci
npm run typecheck
npm test
npm run build:demo
npm audit
```

## 2026-06-04 云端 Demo 部署准备

已准备 Render 部署：

- 根目录新增 `render.yaml`。
- `demo-server.ts` 默认监听 `0.0.0.0`，支持 Render 注入的 `PORT`。
- 新增 `/healthz`，用于 Render 健康检查。
- `package.json` 新增 `start` 脚本：`node dist-cjs/demo-server.js`。
- `build:demo` 会生成 `dist-cjs/package.json`，保证 CommonJS 构建产物在根包 `type: module` 下可运行。

完整部署说明：

```text
nnz-mvp-2026-06-04-云端Demo部署交接.md
```

云端部署验证与修复记录：

```text
nnz-mvp-2026-06-04-云端部署验证与修复.md
```

今日工作记录和下一步安排：

```text
nnz-mvp-2026-06-04-工作记录与下一步安排.md
```



## 云端 Demo（2026-06-04）

```text
https://nnz-kego.onrender.com
```

2026-06-05 校验：

- `/healthz` 返回 `ok=true`。
- GitHub CI 对最新已推送提交通过。
- 云端 `/api/chat` 实测 A/B 回复不完全相同。
- 用户已在 Render 配置 LLM 环境变量后，云端短会话确认走 LLM 路径；连续多轮对话触发 extraction，A 生成 `CHAT_EXCERPT` 与 proposal，B 未被污染。
- 推送 `ef2b364` 后云端 smoke 通过：A/B 回复非空、不相等、无机制词、不是确定性 fallback；连续多轮触发 extraction 后，A 有 9 条 `CHAT_EXCERPT` 和 2 条 proposal，B 无 `CHAT_EXCERPT`、无 proposal、无 A 的婚礼节点记忆。

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
│   ├── llm-reply.ts      — LLM reply prompt contract + sanitize + fallback
│   ├── soul-guard.ts     — 安全护栏（极端情绪检测 / 占卜拒绝 / 每日限额 / 依赖提醒）
│   ├── soul-runtime.test.ts — 4 条 runtime 测试
│   ├── llm-reply.test.ts    — 7 条 LLM prompt/fallback 测试
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

**52 条测试通过**（本地 typecheck/test/build 验证）：

- `soul-scope.test.ts` — 19 条
- `soul-runtime.test.ts` — 4 条
- `llm-reply.test.ts` — 7 条
- `soul-guard.test.ts` — 14 条
- `llm/adapter.test.ts` — 4 条
- `extraction/orchestrator.test.ts` — 4 条

## 下一步：推荐推进顺序

### 优先：持久化

Step 5.1 已完成并通过云端 smoke。当前全内存 store，进程重启数据丢失。下一步建议抽取 `SoulStore` interface，再做 SQLite 或 Postgres 持久化。

建议顺序：

1. 定义 `SoulStore` interface，先由 `InMemorySoulStore` 实现。
2. 增加 SQLite schema 草案。
3. 为 scope isolation / proposal / extraction cursor 设计持久化测试。
4. 再实现 `SqliteSoulStore`。

### 其次：后台拆分

将 Soul Ops Console 从 demo 页面拆成独立后台模块，增加 RBAC、audit log、数据删除流水。

### 再次：微信 / H5 用户端雏形

用户端只暴露自然聊天、记忆收集、节点、封存/毕业体验，不暴露 LLM、SoulVersion、Proposal、scope 等机制。


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

---

## 2026-06-05 更新：LLM 接入 + 提取管线

**DeepSeek V4 Pro** 已接入对话生成和自动化提取管线。Step 5.1 后测试增至 52 条全绿。

### 新增模块

- `src/llm/` — LLM adapter（OpenAI-compatible + mock）
- `src/extraction/` — 提取管线（prompts + 置信度 + 编排器）
- `src/runtime/llm-reply.ts` — LLM reply prompt contract + fallback
- `src/env.ts` — .env 自动加载

### 对话生成

`generateLlmReply()` 替代确定性 `generateSoulReply`：注入 Soul 身份 + Memory + 安全规则 → DeepSeek 生成自然回复。无 adapter 时自动 fallback 到确定性生成。

### UI 改进

加载状态（按钮变灰 + 脉冲动画）+ 连续相同消息去重（不重复调 LLM）。

### 2026-06-05 接手校验

- 本地与远端同步：`main...origin/main`。
- `origin` 已清理为普通 HTTPS URL，不再包含 PAT。
- 仓库正文未发现真实 `ghp_` / `github_pat_` / `sk-` 密钥。
- `/tmp` 干净副本验证通过：45 tests passed，build/audit 通过。
- 当前本地 Step 5.1 验证通过：52 tests passed，`build:demo` 通过。
- 云端 `/api/chat` A/B 输出不相等。
- 本地 iCloud `node_modules` 偶发缺依赖文件，不能把这个误判为源码失败。

### 详细记录

见 `nnz-mvp-2026-06-05-工作记录.md`
