# Claude Code Handoff: 念念在 MVP Core

本文档给下一位 AI / Claude Code / 开发者接手使用。它说明当前目标、代码结构、运行方式、验证路径、已实现边界，以及下一步计划。请先读完本文档，再修改代码。

## 1. 当前项目位置

工作目录：

```bash
/Users/will/Library/Mobile Documents/iCloud~md~obsidian/Documents/黑曜石知识库/Personal/我还在/nnz-mvp
```

根目录还有一个早期静态原型 `index.html`，但当前可运行的 Soul 作用域 MVP 在 `nnz-mvp/` 下。

## 2. 产品意图

这个 MVP 的核心不是做一个完整聊天产品，而是验证一条非常重要的产品和架构规则：

> 不同用户拥有不同 Soul。

这里的 Soul 不是“某个逝者的全局人格模型”，而是“某个用户基于自己与逝者的关系、记忆、资料、纠正和节点事件重建出的关系性心智模型”。

例如两个用户都创建名为“爸爸”的 AI：

- 用户 A 的“爸爸”是 A 与父亲关系中的 Soul。
- 用户 B 的“爸爸”是 B 与父亲关系中的 Soul。
- 即使 displayName 都是“爸爸”，两套 Soul 也必须完全独立。
- A 的聊天、纠正、婚礼节点、记忆更新不能污染 B。
- B 的 Soul 也不能被 A 的资料自动增强、合并或推断。

这不是临时实现细节，而是产品伦理和架构边界。

## 3. 最高优先级规则

所有 Soul / Memory / Snapshot / Node / Conversation 访问必须同时带：

```ts
userId + personaId
```

禁止：

- 只按 `personaId` 查询 Soul。
- 建立全局 `DeceasedSoul`。
- 跨用户聚合人格。
- 因同名、相似关系、家庭成员身份自动合并 Soul。
- A 用户的纠正影响 B 用户。
- A 用户的节点记忆进入 B 用户检索结果。
- 删除 A 用户数据时删除 B 用户数据。

如果未来要做多人共同创建同一个逝者，必须另起一个明确产品模式，例如：

```text
Shared Memorial Space
```

共享模式必须显式邀请、授权、可撤回，并产生新的共享 Soul。它不能覆盖任何个人私有 Soul。

## 4. 当前已实现内容

当前包实现了五层：

1. Domain Store：用户私有 Soul / Memory / Node / Conversation 的内存存储和作用域保护。
2. Soul Runtime：确定性 fallback，把当前用户自己的 Soul + Memory + 输入消息转成自然回复。
3. LLM Adapter：OpenAI-compatible 对话生成，支持 DeepSeek 等兼容服务。
4. Extraction Pipeline：从用户私有对话中提取候选记忆，并生成可审核 proposal。
5. Demo Server：一个本地网页，展示“两个用户并排聊天”的可感知演示和 Soul Ops Console。

### 4.1 Domain Store

主要文件：

```text
src/domain/types.ts
src/domain/errors.ts
src/domain/soul-store.ts
src/domain/soul-scope.test.ts
```

关键类型：

```ts
Persona: id, userId, displayName, relationship, type
SoulVersion: id, userId, personaId, version, kernelJson, status
SoulSnapshot: id, userId, personaId, soulVersionId, sealedAt
MemoryItem: id, userId, personaId, type, content, confidence, enabledForSoul
SoulUpdateProposal: id, userId, personaId, fieldPath, evidenceIds, status
NodeEvent: id, userId, personaId, name, status, startAt, endAt
ConversationMessage: id, userId, personaId, nodeId?, role, content
```

关键类：

```ts
InMemorySoulStore
```

它负责：

- 创建用户和 Persona。
- 创建、读取、更新 SoulVersion。
- 创建 SoulSnapshot。
- 增加和列出 Memory。
- 创建和接受 SoulUpdateProposal。
- 创建和列出 Node。
- 增加和列出 Conversation。
- 删除某个用户自己的数据。

重要保护：

- `requireScope()` 要求 `userId + personaId` 同时存在。
- `requirePersonaOwnership()` 防止拿 A 的 `userId` 访问 B 的 `personaId`。
- `requireNodeOwnership()` 防止跨 scope 写入节点对话。

### 4.2 Soul Runtime

主要文件：

```text
src/runtime/soul-runtime.ts
src/runtime/llm-reply.ts
src/runtime/soul-runtime.test.ts
src/runtime/llm-reply.test.ts
```

确定性 fallback 入口函数：

```ts
generateSoulReply(input: {
  soul: SoulVersion;
  memories: MemoryItem[];
  message: string;
}): SoulReply
```

职责：

- 读取当前用户自己的 `SoulVersion.kernelJson`。
- 读取当前用户自己的 `MemoryItem[]`。
- 根据用户输入识别轻量 intent：
  - `wedding`
  - `distress`
  - `open`
- 用关系视角、幽默程度、口头禅、节点记忆生成一条自然聊天回复。

当前 demo 优先使用 `src/runtime/llm-reply.ts` 中的 `generateLlmReply()` 调用 LLM；当 `NNZ_LLM_API_KEY` 不存在、LLM 调用失败进入 fallback、模型返回空字符串、或输出触发机制泄漏 guard 时，再使用 `generateSoulReply()`。

LLM prompt 当前注入：

- 当前 `userId + personaId` 下的 Soul kernel。
- 当前 `userId + personaId` 下允许进入 runtime 的 Memory。
- 最近 12 条本 scope conversation。
- relationship、petPhrases、humorLevel、knowledgeCutoff、node context。

非常重要：Runtime 的前台回复不能自曝后台机制。

禁止在 AI 人物聊天内容里出现类似：

```text
userId
personaId
SoulVersion
MemoryItem
kernelJson
作用域
检索
证据
节点里的
不是我本来就知道
只按
别人的记忆
```

这些词放在测试常量：

```ts
MECHANISM_LEAK_TERMS
```

如果要调整回复文案，请同步更新测试，确保“差异可感知，但人物不直接解释系统机制”。

### 4.3 Demo Server

主要文件：

```text
src/demo-server.ts
```

它提供一个本地 HTTP 服务，默认端口：

```text
http://127.0.0.1:3007
```

页面展示：

- 用户 A 与“爸爸”的聊天栏。
- 用户 B 与“爸爸”的聊天栏。
- 一键跑完整验证。
- 对 A 应用纠正。
- 创建 A 的婚礼节点。
- 同一句话同时发给 A / B。
- PASS / WAIT 检查项。
- 原始状态 JSON。

当前 demo fixture：

- 用户 A：关系是“女儿”，初始幽默度 low，口头禅“你自己拿主意”。
- 用户 B：关系是“儿子”，幽默度 medium，口头禅“慢慢来”。
- 点击“一键跑完整验证”后：
  - A 增加纠正：“爸爸其实很幽默，只是不太主动开玩笑。”
  - A 的 Soul humorLevel 从 low 更新为 high。
  - A 创建“婚礼”节点和 NODE_MEMORY。
  - B 不发生变化。

### 4.4 LLM Adapter

主要文件：

```text
src/llm/types.ts
src/llm/adapter.ts
src/llm/adapter.test.ts
src/env.ts
```

当前支持：

- OpenAI-compatible `/chat/completions` API。
- `NNZ_LLM_API_KEY`。
- `NNZ_LLM_BASE_URL`。
- `NNZ_LLM_MODEL`。
- `jsonMode`，用于结构化提取。
- Mock adapter，用于测试。
- 本地 `.env` 自动加载；生产环境使用平台环境变量。

注意：不要把真实 LLM key 写入仓库。`nnz-mvp/.env` 只能留在本地或部署平台环境变量中。

### 4.5 Extraction Pipeline

主要文件：

```text
src/extraction/types.ts
src/extraction/prompts.ts
src/extraction/confidence.ts
src/extraction/orchestrator.ts
src/extraction/orchestrator.test.ts
```

当前行为：

- 每个 `userId + personaId` scope 单独记录 extraction 进度。
- 每 5 条新增 conversation 触发一次提取。
- 最近 10 条 conversation 进入提取窗口。
- LLM 以 JSON mode 返回候选字段。
- 提取结果先落为 `CHAT_EXCERPT` memory，`source=CONVERSATION`。
- 只有置信度足够且字段在白名单内，才生成 `SoulUpdateProposal`。
- Proposal 仍需后台接受后才会更新 Soul。

这条管线不会把 A 的对话提取给 B，也不会跨用户合并同名“爸爸”。

## 5. 环境和依赖

当前本机环境：

```bash
node --version
# v25.6.1

npm --version
# 11.9.0
```

项目依赖已安装在：

```text
nnz-mvp/node_modules
```

如果需要从零安装：

```bash
cd "/Users/will/Library/Mobile Documents/iCloud~md~obsidian/Documents/黑曜石知识库/Personal/我还在/nnz-mvp"
npm install
```

核心 devDependencies：

```json
{
  "@types/node": "^25.9.1",
  "tsx": "^4.22.4",
  "typescript": "^5.8.3",
  "vitest": "^4.1.8"
}
```

## 6. 常用命令

进入项目目录：

```bash
cd "/Users/will/Library/Mobile Documents/iCloud~md~obsidian/Documents/黑曜石知识库/Personal/我还在/nnz-mvp"
```

类型检查：

```bash
npm run typecheck
```

测试：

```bash
npm test
```

编译 demo：

```bash
npm run build:demo
```

启动 demo：

```bash
npm run demo
```

访问：

```text
http://127.0.0.1:3007
```

## 7. 重要构建细节

`package.json` 是：

```json
{
  "type": "module"
}
```

但 demo server 运行时使用 CommonJS 编译产物：

```bash
npm run build:demo
node dist-cjs/demo-server.js
```

原因：之前直接用 `tsx` 在这个 iCloud/Obsidian 路径下启动时表现不稳定，所以改成先编译再运行。

`dist-cjs/package.json` 内容是：

```json
{
  "type": "commonjs"
}
```

不要随手删除这个文件。没有它，根目录的 ESM 设置可能影响 `dist-cjs/*.js` 的运行。

`tsconfig.demo.json` 当前包含：

```json
{
  "include": ["src/demo-server.ts", "src/domain/**/*.ts", "src/runtime/**/*.ts"]
}
```

注意：`demo-server.ts` 当前已经直接 import `src/llm/**/*.ts` 与 `src/extraction/**/*.ts`，TypeScript 会跟随 import 编译这些文件。如果未来新增不被 `demo-server.ts` import 的 demo 独立入口，再把对应目录补进 `tsconfig.demo.json`。

## 8. 如何手动验证演示

启动服务：

```bash
npm run demo
```

浏览器打开：

```text
http://127.0.0.1:3007
```

推荐验证步骤：

1. 点击“重置演示”。
2. 点击“一键跑完整验证”。
3. 输入或保留默认句子：

```text
爸，我要结婚了。
```

4. 点击“同时发送给 A / B”。
5. 观察左右两栏。

预期：

- A 回复包含“丫头”“领口”“你自己拿主意”等 A 私有 Soul / 私有节点带来的表达。
- B 回复包含“儿子”“慢慢来”等 B 私有 Soul 表达。
- B 不出现 A 的婚礼节点语境。
- PASS 检查全部通过。
- 回复不出现后台机制词。

## 9. 如何用 API 验证

服务启动后，可用 Node 脚本快速验证：

```bash
node <<'NODE'
const base = 'http://127.0.0.1:3007';

async function post(path, body = {}) {
  const res = await fetch(base + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${path} ${res.status}: ${await res.text()}`);
  return res.json();
}

async function get(path) {
  const res = await fetch(base + path);
  if (!res.ok) throw new Error(`${path} ${res.status}: ${await res.text()}`);
  return res.json();
}

await post('/api/reset');
await post('/api/run-all');
const chat = await post('/api/chat', { message: '爸，我要结婚了。' });
const verification = await get('/api/verification');

const aReply = chat.userA.conversations.at(-1)?.content ?? '';
const bReply = chat.userB.conversations.at(-1)?.content ?? '';
const forbidden = [
  'userId',
  'personaId',
  'SoulVersion',
  'MemoryItem',
  'kernelJson',
  '作用域',
  '检索',
  '证据',
  '节点里的',
  '不是我本来就知道',
  '只按',
  '别人的记忆',
];

console.log(JSON.stringify({
  aReply,
  bReply,
  aDiff: aReply.includes('丫头') && aReply.includes('你自己拿主意') && aReply.includes('领口'),
  bDiff: bReply.includes('儿子') && bReply.includes('慢慢来'),
  noMechanismLeak: forbidden.every((term) => !aReply.includes(term) && !bReply.includes(term)),
  allChecksPassed: verification.checks.every((check) => check.passed),
}, null, 2));
NODE
```

预期输出里这些字段都为 `true`：

```json
{
  "aDiff": true,
  "bDiff": true,
  "noMechanismLeak": true,
  "allChecksPassed": true
}
```

## 10. 当前 API

Demo server routes：

```text
GET  /
GET  /api/state
GET  /api/verification
POST /api/chat
POST /api/run-all
POST /api/apply-correction
POST /api/create-node
POST /api/reset
```

### GET /api/state

返回当前 A/B fixture：

```ts
{
  userA: {
    user,
    persona,
    latestSoul,
    memory,
    nodes,
    conversations
  },
  userB: {
    user,
    persona,
    latestSoul,
    memory,
    nodes,
    conversations
  }
}
```

### GET /api/verification

返回 PASS 检查：

- 同名人格仍然生成两套 Soul。
- A 的纠正不影响 B。
- A 的婚礼节点记忆不出现在 B。
- A 的节点不出现在 B。
- A 的节点对话不出现在 B。

注意：普通聊天会同时写入 A/B conversation；验证项刻意检查“节点对话”，不是总对话数。

### POST /api/chat

请求：

```json
{
  "message": "爸，我要结婚了。"
}
```

效果：

- 同一句用户消息写入 A/B。
- 分别使用 A/B 自己的 Soul + Memory 生成 assistant 回复。
- 返回完整 state。

### POST /api/run-all

效果：

- 应用 A 的纠正。
- 创建 A 的婚礼节点。
- 返回 verification。

### POST /api/reset

效果：

- 重建初始 fixture。
- 返回 state。

## 11. 测试覆盖

当前测试文件：

```text
src/domain/soul-scope.test.ts
src/runtime/soul-runtime.test.ts
src/runtime/llm-reply.test.ts
src/runtime/soul-guard.test.ts
src/llm/adapter.test.ts
src/extraction/orchestrator.test.ts
```

当前共 52 条测试。

Domain tests 覆盖：

- 两个用户同名“爸爸”生成独立 SoulVersion。
- A 的 correction 不改变 B。
- A 的 node memory / node conversation 不暴露给 B。
- 删除 A 数据不删除 B 数据。
- 缺少 `userId` 的 Soul / Memory / Snapshot API 直接拒绝。
- `userId` 和 `personaId` 所属不一致时拒绝。

Runtime tests 覆盖：

- A/B 同一句“我要结婚了”生成不同表达。
- A 的 NODE_MEMORY 影响 A 回复。
- B 没有 NODE_MEMORY 时不获得 A 的婚礼节点语境。
- 普通 DESCRIPTION 里提到婚礼，也不会被当成 NODE context。
- 回复不包含后台机制词。

Guard / LLM / Extraction tests 覆盖：

- 极端情绪、占卜、亲密边界、每日限额、依赖提醒等安全护栏。
- A/B prompt contract：relationship、petPhrases、memory、recentConversations、node context 均按当前 scope 注入。
- LLM 空回复 fallback、机制泄漏 fallback、舞台描写清洗。
- OpenAI-compatible adapter 的请求格式、JSON mode、错误处理、env factory。
- Extraction trigger window、JSON parse fallback、confidence merge、proposal 生成。

## 12. 当前设计边界

这只是 MVP Core，不是最终产品服务。

当前没有：

- 数据库。
- 登录鉴权。
- Embedding 检索。
- 长期记忆压缩。
- Snapshot 恢复运行态。
- Shared Memorial Space。
- 多租户后端权限层。
- 生产级 UI 框架。

当前使用内存 store，进程重启数据会丢失。这是有意为之，方便快速验证作用域规则。

当前已有：

- OpenAI-compatible LLM 对话调用。
- DeepSeek 等兼容服务的 env 配置路径。
- 对话到 `CHAT_EXCERPT` memory / proposal 的自动化提取管线。

但这仍是 demo 级接入，不是生产级观测、限流、成本控制和持久化方案。

## 13. 不要轻易破坏的点

### 13.1 不要把 Soul 改成全局

不要新增类似：

```ts
DeceasedSoul
GlobalSoul
personName -> soul
```

这会违背核心规则。

### 13.2 不要只按 personaId 取数据

错误示例：

```ts
getLatestSoulVersion(personaId)
listMemory(personaId)
```

正确示例：

```ts
getLatestSoulVersion({ userId, personaId })
listMemory({ userId, personaId })
```

### 13.3 不要让人物说后台机制

人物聊天不要写：

```text
这是你的节点记忆。
我不是本来知道。
我只按 userId + personaId 回答。
我不会检索别人的记忆。
```

这些可以作为工程文档和调试说明，但不能进入角色前台表达。

产品表达目标是：

> 差异能被用户感知，但机制不能由人物直接说破。

### 13.4 不要把普通 Memory 误当 Node Memory

Runtime 目前只有 `type === 'NODE_MEMORY'` 且内容匹配婚礼语境时，才触发 node-specific 回复。

普通 `DESCRIPTION` 提到“婚礼”不应该让系统认为当前进入婚礼节点。

## 14. 当前阶段和建议下一步计划

建议按下面顺序推进，避免过早变复杂。

### Step 1: Runtime Covenant 状态层（已完成并收口）

已引入 RuntimeSession 的状态叠加：

```ts
ACTIVE
SEALED
NODE
GRADUATED
```

目标：

- ACTIVE：可持续学习和更新。
- SEALED：使用封存 SoulSnapshot，默认不继续学习。
- NODE：在某个节点事件中临时唤起，默认使用该用户自己的封存快照 + 节点上下文。
- GRADUATED：完成关系任务后减少主动性或进入纪念态。

注意：状态叠加仍然必须在 `userId + personaId` scope 内。

当前收口状态：

- 创建新的 `ACTIVE` `SoulVersion` 时，会归档同一 `userId + personaId` 下旧的 ACTIVE 版本，避免封存后回退显示旧 Soul。
- `sealSoul(scope)` 创建包含 `kernelJson` 和 `memoryIds` 的 `SoulSnapshot`，并进入 `SEALED`。
- `activateNode(scope, nodeName)` 只允许从 `SEALED` 进入 `NODE`；同名 active 节点会被复用，避免重复创建“婚礼”节点。
- `completeNode(scope)` 将当前节点标记为 `COMPLETED`，并回到 `SEALED`。
- `graduateSoul(scope)` 只让当前用户/persona 进入 `GRADUATED`，不影响其他用户。
- 封存提示文案已与 UI 按钮一致，不再提示未实现的 `#节点` 命令。

### Step 2: Memory Vault 分层（基础已完成）

Memory 已按使用路径分层，不再只依赖单一 `enabledForSoul`。

当前 `MemoryItem` 字段包括：

- `source`: `USER_INPUT` / `UPLOAD` / `CONVERSATION` / `CORRECTION` / `NODE` / `SYSTEM`
- `sensitivity`: `LOW` / `MEDIUM` / `HIGH` / `RESTRICTED`
- `enabledForRuntime`
- `enabledForSoulUpdate`
- `evidenceIds`
- `createdBy`
- `state`

当前 Store 规则：

- `listRuntimeMemory(scope)`：只返回当前用户/persona 下可进入运行时回复的 ACTIVE 记忆；排除 `RISK` 和 `RESTRICTED`。
- `listSoulUpdateMemory(scope)`：只返回当前用户/persona 下可推动 Soul 更新的 ACTIVE 记忆；排除 `NODE_MEMORY`、`RISK` 和 `RESTRICTED`。
- `createSoulUpdateProposal(...)` 会拒绝不能作为 Soul 更新证据的 memory id。
- `NODE_MEMORY` 默认可进 runtime，但不能推动 Soul 更新。
- `RISK` 默认 `source=SYSTEM`、`sensitivity=RESTRICTED`，既不进 runtime，也不推动 Soul 更新。

后续增强：

- 上传资料和对话摘录的 evidence 链。
- Memory 禁用/归档 UI。
- 风险/禁区策略进入单独 guard 层，而不是角色温情回复。
- Memory 检索摘要器，为 LLM prompt 做更稳定的压缩与排序。

### Step 3: SoulUpdateProposal 审核流程（基础已完成）

Soul 更新现在是可见、可接受、可拒绝、有证据、有字段白名单的审核流程。

当前已实现：

- `listSoulUpdateProposals(scope, status?)`
- `listSoulUpdateProposalEvidence(scope, proposalId)`
- `rejectSoulUpdateProposal(scope, proposalId)`
- `acceptSoulUpdateProposal(scope, proposalId)`
- proposal evidence 仍严格限制在当前 `userId + personaId` scope。
- Demo 中“生成用户 A 纠正提案”只创建 PENDING proposal，不直接更新 Soul。
- “接受 A 提案”后 A 的 Soul 才从 low -> high。
- “拒绝 A 提案”后 A 的 Soul 保持 low。
- Demo 提案面板已展示 `oldValue -> newValue` 和证据，不再只显示孤立的“建议值 high”。
- `ACCEPTED` / `REJECTED` 是终态：接受已拒绝提案不会生效，拒绝已接受提案不会回滚。
- 拒绝后可以再次生成一条新的独立 `PENDING` proposal。
- UI 按钮按状态禁用：只有存在 `PENDING` proposal 时才能接受/拒绝。

当前 fieldPath 白名单：

- `affectModel.humorLevel`
- `languageModel.petPhrases`
- `identityCore.relationship`

后续增强：

- 多条 proposal 队列。
- reject reason。
- fieldPath schema 化，而不是硬编码字符串数组。

### Step 4: Snapshot 和 Sealed Mode（基础已完成，后续增强）

当前已实现：

- `SoulSnapshot` 存 `soulVersionId`、`kernelJson`、`memoryIds`。
- `NODE` 状态默认从该用户自己的 snapshot 重建 runtime context。
- `SEALED` / `GRADUATED` 状态不会进入普通 runtime 生成回复。

后续可以增强：

- Snapshot 详情展示。
- Snapshot diff。
- 多次节点唤起历史。
- 用户可读的封存说明和撤销/导出策略。

### Step 4.5: Soul Ops Console 和成熟度分析（概念验证已完成）

用户端应对 LLM、Proposal、Snapshot、封存状态机等机制无感；后台需要能观察和治理这些机制。

当前已实现：

- 新增 `SoulMaturityReport` / `SoulRecommendation` 类型。
- `InMemorySoulStore.buildSoulMaturityReport(scope)`。
- 成熟度分项：
  - evidenceCoverage
  - identityClarity
  - voiceConsistency
  - memoryReliability
  - runtimeStability
  - safetyReadiness
- 成熟度等级：
  - `L0_SEED`
  - `L1_SKETCH`
  - `L2_USABLE`
  - `L3_STABLE`
  - `L4_SEALED_READY`
  - `L5_LEGACY_READY`
- Demo 状态 JSON 中每个用户都有 `ops.maturity`。
- 页面新增 `Soul Ops Console` 后台治理视图，并排展示用户 A / B 的成熟度、分项、Memory / Proposal / Snapshot / Node 数量和 recommendations。
- 成熟度报告仍严格按 `userId + personaId` 生成，A 的 Memory / Proposal / Node 不会进入 B 的 report。

当前 recommendations 包括：

- `ASK_MORE_MEMORY`
- `REQUEST_CHAT_UPLOAD`
- `REVIEW_PROPOSAL`
- `REVIEW_CONFLICT`
- `SUGGEST_SEAL`
- `LIMIT_RUNTIME`
- `REVIEW_RISK`
- `READY_FOR_NODE`
- `READY_FOR_GRADUATION`

注意：当前成熟度算法是可解释启发式，不是最终模型评分。后续接真实 LLM / embedding / quality evaluator 时，应保留 `SoulMaturityReport` 的接口契约，替换内部计算器。

阶段实施记录见根目录：

```text
nnz-mvp-Step4.5-SoulOps后台治理实施记录.md
```

### Step 5: Prompt Contract 与云端 Smoke（本地已完成，待推送后云端复测）

真实 LLM 接入已经完成到 demo 级别。Step 5.1 已把当前 prompt 和 LLM 输出兜底变得可测试、可回归：

1. 已从 `src/demo-server.ts` 中抽出 `buildLlmReplyPrompt()` 纯函数，落在 `src/runtime/llm-reply.ts`。
2. 已为 A/B prompt 增加 contract test：
   - A 注入“女儿 / 丫头 / 你自己拿主意”。
   - B 注入“儿子 / 慢慢来”。
   - A 的 NODE_MEMORY 不进入 B。
   - recentConversations 只来自当前 `userId + personaId`。
3. 已增加 LLM 输出 guard 测试：
   - 空字符串 fallback。
   - 机制泄漏 fallback。
   - 舞台描写清洗。
4. 推送后仍需做云端 `/api/chat` smoke：
   - 同一句消息发给 A/B。
   - A/B assistant reply 不相等。
   - reply 不含机制词。
5. Render 环境变量已由用户配置并通过云端行为确认生效：
   - `NNZ_LLM_API_KEY`
   - `NNZ_LLM_BASE_URL`
   - `NNZ_LLM_MODEL`

长期仍建议把 runtime 演化为：

```text
Runtime input builder -> prompt contract -> model call -> response guard -> memory update proposal
```

仍需保留：

- scope guard。
- mechanism leak guard。
- evidence boundary。
- user-private memory selection。

不要把完整 Memory 直接塞给模型。应先做当前用户私有范围内的筛选和摘要。

### Step 6: UI 从 demo 升级为双端工作台

当前页面是单文件 HTML string，适合验证。

如果要做真正应用，建议迁移到前端框架，并明确拆成用户端与后台端。

用户端（微信 / 小程序 / App）应尽量无感：

- 不展示 `SoulVersion`、`SoulSnapshot`、`SoulUpdateProposal`、`MemoryItem` 等机制名。
- 不解释 LLM、检索、证据链、`userId + personaId`。
- 只提供自然的记忆注入、对话、节点触发、纪念物、导出/删除体验。

后台端建议建设 `Soul Ops Console`：

- Persona list。
- Memory vault inspector。
- Soul kernel inspector。
- Proposal review。
- Snapshot / Seal controls。
- Soul maturity analytics。
- Risk event console。
- User lifecycle dashboard。

但在迁移前，不要丢掉现在这些测试。

详见根目录文档：

```text
念念在-产品与技术架构：后台治理与Soul成熟度.md
```

## 15. 排障

### 15.1 端口 3007 被占用

查看：

```bash
lsof -nP -iTCP:3007 -sTCP:LISTEN
```

如果确认是旧 demo：

```bash
kill <PID>
npm run demo
```

### 15.2 demo 编译后运行报 ESM/CJS 错

检查：

```bash
cat dist-cjs/package.json
```

应为：

```json
{
  "type": "commonjs"
}
```

如果缺失，重新创建它。

### 15.3 改了 runtime 但 demo 没变

需要重新跑：

```bash
npm run demo
```

`demo` 脚本会先跑 `npm run build:demo`，然后启动 `dist-cjs/demo-server.js`。

### 15.4 测试通过但 typecheck 失败

当前 TypeScript 很严格：

```json
{
  "strict": true,
  "noUncheckedIndexedAccess": true,
  "exactOptionalPropertyTypes": true
}
```

尤其注意 `exactOptionalPropertyTypes`：可选字段不能显式传 `undefined`，要么不传该字段，要么把类型写成 `string | undefined`。

## 16. 最近一次已验证状态

最近一次验证内容：

```bash
git status --short --branch
git ls-remote --heads origin main
curl https://nnz-kego.onrender.com/healthz
POST https://nnz-kego.onrender.com/api/chat
/tmp clean copy: npm ci -> typecheck -> test -> build:demo -> audit
```

结果：

- 本地与远端同步：`main...origin/main`。
- 远端 `main` 指向 `35349d8 docs: refresh llm deployment handoff`。
- GitHub Actions 最新 run 为 success。
- Render demo `/healthz` 返回 `ok=true`。
- 云端 `/api/chat` 实测 A/B 回复不相同：A 使用“丫头 / 你自己拿主意”，B 使用“儿子 / 慢慢来”。
- Render LLM 环境变量配置后，云端短会话确认走 LLM；连续多轮触发 extraction，A 生成 `CHAT_EXCERPT` 与 proposal，B 未被污染。
- `/tmp` 干净副本验证通过：45 tests passed，build 通过，audit 0。
- 当前本地 Step 5.1 验证通过：52 tests passed，`build:demo` 通过。

注意：当前 iCloud/Obsidian 路径下，`node_modules` 偶发缺可选依赖或包文件，直接 `npm test` 可能误报失败。可靠验证方式是复制到 `/tmp` 后重新 `npm ci`，或清理本地 `node_modules` 后重装。

安全补充：本地 `origin` 曾包含 GitHub PAT，已改回普通 HTTPS URL。建议用户在 GitHub 后台 revoke 旧 token。仓库正文复查未发现真实 `ghp_` / `github_pat_` / `sk-` 密钥。

## 17. 给下一位 AI 的工作原则

接手时请优先保持以下判断：

1. 这是一个“关系性 Soul”产品，不是全局逝者人格数据库。
2. `userId + personaId` 是最高优先级边界。
3. 用户能感知差异，但角色不能直接解释后台机制。
4. 每次新增能力，都要问：这会不会让 A 的记忆影响 B？
5. 每次改回复文案，都要问：这是不是太像系统说明？
6. 每次改 store/API，都要补作用域测试。
7. 每次改 runtime，都要补“差异可感知 + 机制不外露”测试。

如果不确定，宁可先扩测试，再改实现。
