# Claude Code Handoff: 念念在 MVP Core

本文档给下一位 AI / Claude Code / 开发者接手使用。它说明当前目标、代码结构、运行方式、验证路径、已实现边界，以及下一步计划。请先读完本文档，再修改代码。

## 1. 当前项目位置

工作目录：

```bash
/Users/will/Library/Mobile Documents/iCloud~md~obsidian/Documents/黑曜石知识库 2/Personal/我还在/nnz-mvp
```

注意：2026-06-22 核查时发现无后缀的 `黑曜石知识库/Personal/我还在` 是异常空壳副本，`.git` 不完整且源码/文档缺失。当前完整副本在 `黑曜石知识库 2/Personal/我还在`。根目录还有一个早期静态原型 `index.html`，但当前可运行的 Soul 作用域 MVP 在 `nnz-mvp/` 下。

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
5. Demo Server：同时提供首页 H5 用户端验证流、`/demo` 的“两用户并排聊天”开发者验证页，以及受 `NNZ_OPS_TOKEN` 保护的独立 `/ops` Soul Ops 后台雏形。

### 4.0 最新 H5 状态（2026-06-23）

`public/index.html` 当前首页 H5 体验是 modal 打开方式，不是页面内重复 demo。

已修复：

- 导航和首页 CTA 会调用 `openExperience(event)` 打开同一个 H5 modal。
- `h5RenderConversation()`、`h5AuthHeaders()`、`h5CovenantAction()` 的历史断点已修复。
- 「创建你想念的人」Page 1 已改为左右结构：左侧输入称呼、关系、口头禅，右侧展示常用称呼快速选择。
- 常用称呼选中态已强化为实底、白字、边框和阴影，并支持键盘焦点态。
- 「勾选你记得的特征」已改为复选框式真多选；同一组可多选，取消一个不会清掉其他选择。
- 创建人格描述会保留全部多选特征；提交给后端的 `traits` 仍保持当前字符串兼容形态，避免影响 `humorLevel` 等既有逻辑。

2026-06-23 验证：

```text
node inline script / DOM smoke: passed
git diff --check: passed
npm run typecheck: passed
npm test: passed, 12 test files / 79 tests
npm run build:demo: passed
H5 multi-select behavior smoke: passed
GitHub Actions run 28012032867: success
Render /healthz: passed, postgres fixture
Render homepage HTML smoke: confirmed modal hidden guard, openExperience CTA, trait-check checkbox UI
```

记录见根目录：

```text
nnz-mvp-2026-06-23-H5创建体验选项交互优化.md
```

### 4.1 Domain Store

主要文件：

```text
src/domain/types.ts
src/domain/errors.ts
src/domain/soul-store.ts
src/domain/scoped-soul-repository.ts
src/domain/postgres-scoped-soul-repository.ts
src/domain/soul-scope.test.ts
src/domain/scoped-soul-repository.test.ts
src/domain/postgres-scoped-soul-repository.test.ts
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

新增 `ScopedSoulRepository`：

```ts
const repo = bindSoulRepository(store, { userId, personaId });
```

它在绑定时验证完整 scope 和 persona ownership。绑定后，调用方通过 repo 执行 Soul / Memory / Snapshot / Proposal / Node / Conversation / Covenant / Runtime / Maturity 操作，不需要在每次调用时重新传 scope。即使调用方用 `as never` 传入其他 `userId/personaId`，repo 也会以绑定 scope 为准。这是后续从全量 snapshot persistence 演进到 Postgres scoped repositories 的适配层。

新增 `PostgresScopedSoulRepository`（2026-06-23 Step 2.5）：

```ts
const repo = createPostgresScopedSoulRepositoryFromPool(pool, { userId, personaId });
```

这是逐表 Postgres repository 的最小旁路切片，当前覆盖：

- `nnz_users`
- `nnz_personas`
- `nnz_memory_items`
- `nnz_conversation_messages`

关键边界：

- 构造 repository 时必须绑定完整 `userId + personaId`。
- Memory / Conversation 写入前会确认 persona 属于该 user。
- Memory / Conversation 查询都带 `WHERE user_id = $1 AND persona_id = $2`。
- `nnz_memory_items` 和 `nnz_conversation_messages` 使用 `(user_id, persona_id)` 复合外键指向 `nnz_personas(user_id, id)`。
- 目前还没有替换 demo runtime 的 Postgres snapshot persistence；线上稳定路径仍是 `nnz_store_snapshots` JSONB 快照。

2026-06-24 Step 2.6 已继续扩展 Covenant 主链：

- 新增 `nnz_soul_versions`
- 新增 `nnz_soul_snapshots`
- 新增 `nnz_node_events`
- 新增 `nnz_runtime_sessions`
- `createSoulVersion()` 创建新 ACTIVE 时只归档当前 scope 的旧 ACTIVE。
- `sealSoul()` 创建 snapshot、归档当前 active soul，并进入 SEALED。
- `activateNode()` 只允许从 SEALED 进入 NODE，复用同名 active node，并写同 scope 的 NODE_MEMORY。
- `completeNode()` 只完成当前 scope 的 node，并回到 SEALED。
- `graduateSoul()` 只把当前 scope 的 soul versions 与 session 标为 GRADUATED。
- `addConversation({ nodeId })` 会校验 node ownership，拒绝引用其他 scope 的 node。

2026-06-24 Step 2.7 已补齐剩余关键表：

- 新增 `nnz_soul_update_proposals`
- 新增 `nnz_credentials`
- 新增 `nnz_ops_audit_events`
- Proposal 创建、列表、证据读取、接受、拒绝均已实现。
- Proposal evidence 只能来自同 scope 且允许 Soul Update 的 memory。
- Accept proposal 会创建同 scope 新 ACTIVE SoulVersion，不影响其他用户。
- Credential 绑定 user，按 email 查回。
- OpsAuditEvent 逐表保存，仍是后台对象，不进入用户前台。

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

首页 `/` 当前展示：

- 用户注册 / 登录。
- 创建“记忆中的人”。
- 发送第一句话并查看私密对话。
- 所有用户端接口都从 JWT 读取 auth user，不接受前端传 `userId`。

用户端接口：

```text
GET /api/me
GET /api/me/personas
POST /api/me/persona
GET /api/me/chat-history?personaId=...
POST /api/me/chat
```

`/demo` 开发者页面展示：

- 用户 A 与“爸爸”的聊天栏。
- 用户 B 与“爸爸”的聊天栏。
- 一键跑完整验证。
- 对 A 应用纠正。
- 创建 A 的婚礼节点。
- 同一句话同时发给 A / B。
- PASS / WAIT 检查项。
- 原始状态 JSON。

当前 `/demo` fixture：

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

### 4.6 Soul Ops Admin Prototype

主要文件：

```text
src/ops/ops-console.ts
src/ops/ops-console.test.ts
```

当前后台入口：

```text
GET  /ops
GET  /api/ops/overview
POST /api/ops/cleanup-test-users
```

启用条件：

```bash
NNZ_OPS_TOKEN=<strong-random-token>
```

权限行为：

- 未配置 `NNZ_OPS_TOKEN`：`/ops` 显示后台未启用，`/api/ops/*` 返回 404。
- 已配置但请求缺 token：返回 401。
- token 错误：返回 403。
- token 可放在 `x-ops-token`，也可放在 `Authorization: Bearer ...`。

云端状态（2026-06-16）：

```text
Render Web Service: nnz
Service ID: srv-d8go7pmq1p3s739r12jg
URL: https://nnz-kego.onrender.com
NNZ_OPS_TOKEN: 已在 Render 环境变量中配置，文档和仓库不记录明文
```

云端 smoke：

```text
GET  /ops                         -> 200
GET  /api/ops/overview             -> 401
GET  /api/ops/overview wrong token -> 403
GET  /api/ops/overview with token  -> 200
POST /api/ops/cleanup-test-users dry-run with token -> 200
```

cleanup dry-run 识别到 1 个明确 smoke/test 用户候选，`deletedUserIds` 为 0。详细记录见根目录 `nnz-mvp-2026-06-16-SoulOps云端启用记录.md`。

Step 2.1 审计日志（2026-06-16）：

- 新增 `OpsAuditEvent`。
- `InMemorySoulStore` 新增 `recordOpsAuditEvent()` 和 `listOpsAuditEvents()`。
- `/api/ops/overview` 成功读取会记录 `OVERVIEW_READ`。
- `/api/ops/cleanup-test-users` dry-run 会记录 `CLEANUP_DRY_RUN`。
- 真删除缺确认码会记录 `CLEANUP_DELETE / DENIED`。
- 真删除成功会记录 `CLEANUP_DELETE / SUCCESS`。
- 缺 token / 错 token 会记录 `ACCESS_DENIED / DENIED`。
- `/ops` 页面新增 `Audit Events` 指标和“最近后台操作”面板。
- 审计事件随 Postgres snapshot 和 SQLite `ops_audit_events` 表持久化。
- 不记录 `NNZ_OPS_TOKEN` 明文、请求 token、聊天内容或上传资料原文。

详细记录见根目录 `nnz-mvp-2026-06-16-Step2.1-SoulOps审计日志.md`。

Step 2.2 RBAC 与删除回执（2026-06-17）：

- 新增 `src/ops/ops-auth.ts` / `src/ops/ops-auth.test.ts`。
- 旧 `NNZ_OPS_TOKEN` 保持可用，映射为 `admin`，actor 为 `ops:legacy-admin`。
- 新增可选角色 token：
  - `NNZ_OPS_VIEWER_TOKEN`
  - `NNZ_OPS_OPERATOR_TOKEN`
  - `NNZ_OPS_ADMIN_TOKEN`
- viewer 只能读取 overview。
- operator 可以读取 overview 和执行 cleanup dry-run。
- admin 可以读取 overview、dry-run，并在 `DELETE_TEST_USERS` 确认码正确时执行真删除。
- cleanup 真删除返回 `receipts` 删除回执。
- `/ops` 页面显示当前 role、actor、权限，并按权限禁用 Dry-run / 确认清理按钮。
- `tsconfig.demo.json` 已补 `src/ops/**/*.ts`，确保 Render `build:demo` 包含 `ops-auth`。

详细记录见根目录 `nnz-mvp-2026-06-17-Step2.2-SoulOps-RBAC与删除回执.md`。

Step 2.3 Audit 查询接口与 Audit tab（2026-06-17）：

- 新增 `GET /api/ops/audit-events`。
- 新增 `AUDIT_QUERY` 审计动作，查询审计本身也会被记录。
- `queryOpsAuditEvents()` 支持按 action / actor / targetUserId 过滤，支持 limit / offset 分页。
- `/ops` 页面拆成 `Dashboard` / `Audit` tab。
- Audit tab 支持 action 下拉、actor 输入、target userId 输入、limit 选择和上一页/下一页。
- 本地干净副本 `/tmp/nnz-step23-verify.iLBxJh` 中 `npm ci`、`npm test`、`npm run typecheck`、`npm run build:demo` 全部通过；11 个测试文件、73 条测试全绿。
- 已推送 `a9735a5 feat: add soul ops audit query`。
- GitHub Actions run `27677337466` success。
- Render `/healthz` 返回 `fixture:"postgres"`；`/ops` 页面包含 Audit tab；`/api/ops/audit-events` 无 token 401、错 token 403。

详细记录见根目录：

```text
nnz-mvp-2026-06-17-Step2.3-SoulOps-Audit查询与角色云端验证.md
nnz-mvp-2026-06-17-Step2.3-推送后云端验收记录.md
```

后台概览能力：

- 全局 totals：users、personas、memories、pending proposals、nodes、conversations、test users、audit events、persistence mode。
- 用户表：displayName/email、demo/test 标识、persona/memory/proposal/message 计数。
- Persona 成熟度卡片：score、level、runtimeState、scope 短 ID、六维成熟度、recommendations。
- 审计面板：最近后台操作、授权拒绝、dry-run、删除尝试。
- 访问角色面板：role、actor、Overview / Dry-run / Delete / Audit 权限。
- 所有 persona 成熟度仍通过 `store.buildSoulMaturityReport({ userId, personaId })` 得到，不按 `personaId` 单查。

测试数据清理能力：

- `POST /api/ops/cleanup-test-users` 默认 dry-run。
- 真删除必须传：

```json
{
  "dryRun": false,
  "confirm": "DELETE_TEST_USERS"
}
```

- 匹配规则保守，只识别明确 smoke/test 账号：
  - `@example.test`
  - `codex-postgres-smoke-*`
  - `codex-ops-smoke-*`
  - `nnz-smoke-*`
- 删除执行 `store.deleteUserScopedData(userId)`，只删该用户自己的 Persona、Soul、Snapshot、Memory、Proposal、Node、Conversation、Session、Credential。
- A/B demo 用户和普通用户不会因为名字里含类似 test 的词而被删除。

注意：这是内部后台，不是用户端页面。用户端 H5 / 微信 / `/demo` 都不应显示 `userId`、`personaId`、scope、proposal evidence 等后台治理对象。

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

本地启用 Soul Ops：

```bash
NNZ_OPS_TOKEN=dev-ops-token npm run demo
open http://127.0.0.1:3007/ops
```

如果本地 `.env` 配了 `NNZ_DB_PATH` 且 `better-sqlite3` 原生包架构不匹配，可先构建，再从不含 `.env` 的目录启动内存模式验证后台：

```bash
npm run build:demo
cd /tmp
HOST=127.0.0.1 PORT=3041 NNZ_OPS_TOKEN=dev-ops-token node "/Users/will/Library/Mobile Documents/iCloud~md~obsidian/Documents/黑曜石知识库/Personal/我还在/nnz-mvp/dist-cjs/demo-server.js"
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
GET  /demo
GET  /ops
GET  /api/state
GET  /api/verification
GET  /api/ops/overview
POST /api/chat
POST /api/run-all
POST /api/apply-correction
POST /api/accept-correction
POST /api/reject-correction
POST /api/create-node
POST /api/seal
POST /api/activate-node
POST /api/complete-node
POST /api/graduate
POST /api/ops/cleanup-test-users
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
src/auth/auth.test.ts
src/domain/soul-scope.test.ts
src/domain/persistence.test.ts
src/domain/postgres-persistence.test.ts
src/domain/postgres-scoped-soul-repository.test.ts
src/extraction/orchestrator.test.ts
src/llm/adapter.test.ts
src/ops/ops-console.test.ts
src/runtime/soul-runtime.test.ts
src/runtime/llm-reply.test.ts
src/runtime/soul-guard.test.ts
```

当前共 87 条默认测试，另有 1 个 opt-in Postgres integration test 默认 skip（2026-06-25 本地验证）。

Domain tests 覆盖：

- 两个用户同名“爸爸”生成独立 SoulVersion。
- A 的 correction 不改变 B。
- A 的 node memory / node conversation 不暴露给 B。
- 删除 A 数据不删除 B 数据。
- 缺少 `userId` 的 Soul / Memory / Snapshot API 直接拒绝。
- `userId` 和 `personaId` 所属不一致时拒绝。
- Postgres scoped repository 中同名「爸爸」的 persona、memory、conversation 在 user A / user B 下互不影响。
- Postgres scoped repository 拒绝 user A + persona B 的跨所有者读写。
- Postgres memory runtime / soul update filters 与 InMemorySoulStore 默认规则一致。
- Postgres scoped Covenant 主链只影响当前 scope：ACTIVE 归档、snapshot、node 复用/完成、graduation、跨 scope node 拒绝。
- Postgres scoped proposal 审核只使用同 scope evidence；credential 按 user 绑定；ops audit 不记录 credential/chat 敏感内容。
- Opt-in Postgres integration test 可用真实数据库验证 schema、JSONB round-trip、复合外键、级联删除；默认没有 `NNZ_POSTGRES_INTEGRATION_URL` 时跳过。

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
- Soul Ops overview / cleanup：只识别明确 smoke 用户，dry-run 不改数据，确认清理只删除测试用户并保留 A/B demo 和普通用户。

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

### Step 5: Prompt Contract 与云端 Smoke（已完成）

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
4. 推送 `ef2b364` 后已完成云端 `/api/chat` smoke：
   - 同一句消息发给 A/B。
   - A/B assistant reply 非空且不相等。
   - reply 不含机制词。
   - reply 不是确定性 fallback 固定句式。
5. Render 环境变量已由用户配置并通过云端行为确认生效：
   - `NNZ_LLM_API_KEY`
   - `NNZ_LLM_BASE_URL`
   - `NNZ_LLM_MODEL`
6. 连续多轮云端对话已触发 extraction：A 生成 9 条 `CHAT_EXCERPT` 与 2 条 proposal；B 无 `CHAT_EXCERPT`、无 proposal、无 A 的婚礼节点记忆。

下一步进入持久化设计。长期仍建议把 runtime 演化为：

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
/tmp clean copy with current worktree diff:
npm ci -> typecheck -> test -> build:demo -> audit
```

结果：

- 2026-06-10 已在首页 `/` 实现真实 H5 用户端私密聊天验证流。
- 新增 `/api/me/*` auth-aware 接口，统一从 token 取 `userId`，创建/读取 persona、conversation、runtime chat 都限制在当前 `userId + personaId`。
- `/demo` 保留为开发者 A/B 隔离验证页，不作为用户端产品面；Soul Ops 已拆到受保护的 `/ops`。
- `/tmp` 干净副本验证通过：10 个测试文件、67 tests passed，typecheck/build 通过。
- API smoke 通过：未登录 `/api/me` 返回 401；用户 A 访问用户 B 的 persona chat history 返回 403；同名“爸爸”的 A/B 回复不同且无机制词泄露。
- 浏览器验证通过：首页桌面注册 -> 创建 -> 聊天；首页未出现“双人演示”开发入口；移动 390x844 无横向溢出；用户可见文案未发现机制词泄露。
- `99c38cb feat: add postgres snapshot persistence` 已推送到 GitHub；`NNZ MVP CI` success。
- Render 云端 smoke 通过：`/healthz` 200 且当时 `fixture: "in-memory"`（2026-06-11 已切到 `fixture: "postgres"`），首页 `/` 已是 H5 真实用户流，`/demo` 仍是开发者验证页，云端 `/api/me/*` 401/403/A-B 隔离均正常。
- 2026-06-09 进入修复前：本地 `main...origin/main [ahead 1]`。
- 远端 `main` 已到 `08a10b8 feat: serve landing page from Render, demo at /demo`，但该批 2026-06-08 变更让 GitHub Actions 失败。
- 本地修复了 `serialize()` credential 类型缺失、`deserialize()` optional undefined、credential 删除跨用户风险、注册 userId 不一致和注册后未持久化。
- `/tmp` 干净副本验证通过：8 个测试文件、61 tests passed，typecheck/build/audit 通过。
- 新增 credential 作用域测试：删除用户 A 不会删除用户 B credential。
- 新增 persistence 测试：credentials save/load 后 userId 不变化。
- `5ac654a fix: restore auth persistence scope` 已推送到 GitHub，`NNZ MVP CI` 已恢复 success。
- Render smoke 已通过：`/healthz`、`/`、`/demo`、`/api/register`、`/api/login`、`/api/chat`。

注意：当前 iCloud/Obsidian 路径下，`node_modules` 偶发缺可选依赖或包文件，直接 `npm test` 可能误报失败。可靠验证方式是复制到 `/tmp` 后重新 `npm ci`，或清理本地 `node_modules` 后重装。

安全补充：本地 `origin` 曾包含 GitHub PAT，已改回普通 HTTPS URL。建议用户在 GitHub 后台 revoke 旧 token。仓库正文复查未发现真实 `ghp_` / `github_pat_` / `sk-` 密钥。

## 16.1 当前下一步

Step 2 scoped repository 与 snapshot migration 工具链已经完成到 Step 2.53。最新已推送提交是 `0e9ffee fix: render h5 persona switcher safely`；H5 persona switcher safe rendering 已完成本地验证并推送。当前本地新增 Step 2.53 H5 request non-JSON safe fallback：`h5Request()` 不再直接 `response.json()`，而是读取 `response.text()` 后安全 `JSON.parse`，遇到非 JSON / 空响应时使用固定“请求失败。”错误，避免网关或静态错误页解析异常进入用户可见错误。本地 h5 targeted test、typecheck、225 tests + 2 skipped、build:demo 通过，尚待下一次合并 push。现在还剩 1 个总外部实跑入口未执行：

1. 注入真实本地 snapshot/SQLite、`NNZ_POSTGRES_INTEGRATION_URL`、Render role token env、`NNZ_POSTGRES_SCOPED_RUNTIME_URL`。
2. 跑 `release:validation-suite -- --evidence-out <sanitized-release-evidence-json>`，它会串 preflight、migration validation、默认非破坏性 Ops role smoke、scoped runtime smoke suite，并写脱敏上线 evidence。
3. 如果 suite 停在某个 stage，用对应单项命令做 focused diagnosis，修复后回到总 suite。

当前不需要每个小步骤都停下来等 push；应按上面目标连续开发和验证。遇到真实 snapshot、`NNZ_POSTGRES_INTEGRATION_URL`、`NNZ_POSTGRES_SCOPED_RUNTIME_URL`、Render role tokens 这类外部输入点时再做明确 checkpoint。完整路线图见 `../nnz-mvp-2026-07-01-Step2-MigrationReadinessRoadmap.md`。

## 16.2 2026-06-11 Render Postgres 排查

已用 Chrome 登录态核查并配置 Render 控制台：

- Web Service `nnz` / `srv-d8go7pmq1p3s739r12jg` 的服务级 Environment 包含 `DATABASE_URL`、`NNZ_LLM_API_KEY`、`NNZ_LLM_BASE_URL`、`NNZ_LLM_MODEL`。
- 项目级 Environment 里 `Env Groups: 0`，不存在“变量在 Env Group 但未链接”的情况。
- 已创建 Free Postgres `nnz-mvp-postgres`，Service ID `dpg-d8l271hkh4rs73fmdtn0-a`，region Ohio，1 GB，$0/month，2026-07-11 到期。
- 当前 Web Service 使用 `DATABASE_URL` 连接 Postgres。不要把连接串写进仓库、文档或聊天记录。
- 排查过程中曾出现 `Failed to start demo server: getaddrinfo ENOTFOUND base`，原因是 `DATABASE_URL` 被错误值污染；已重新覆盖为 Render Postgres URL 并部署成功。

已增强 `/healthz`，新增不泄露密钥的 `persistence` 诊断字段：

```json
{
  "persistence": {
    "mode": "postgres",
    "postgresConfigured": true,
    "postgresEnv": "DATABASE_URL",
    "sqliteConfigured": false
  }
}
```

2026-06-11 云端持久化 smoke 已通过：

```text
注册临时测试用户
创建 persona: 爸爸 / 孩子
发送一句话
chat-history: 2 条（USER + ASSISTANT）
Render Manual Deploy -> Restart service
重新登录同一测试用户
persona 和 chat-history 均可读回
persistedAfterRestart = true
```

Render runtime logs 已确认：

```text
Postgres persistence configured via DATABASE_URL.
LLM adapter initialized for extraction pipeline.
```

接手时先看 `nnz-mvp-2026-06-11-Render-Postgres-排查记录.md`、`nnz-mvp-2026-06-11-Step1-SoulOps独立后台与测试清理.md`、`nnz-mvp-2026-06-16-SoulOps云端启用记录.md`、`nnz-mvp-2026-06-16-Step2.1-SoulOps审计日志.md`、`nnz-mvp-2026-06-17-Step2.2-SoulOps-RBAC与删除回执.md`、`nnz-mvp-2026-06-17-Step2.3-SoulOps-Audit查询与角色云端验证.md`、`nnz-mvp-2026-06-17-Step2.3-推送后云端验收记录.md`、`nnz-mvp-2026-06-23-Step2.5-PostgresScopedRepository计划.md`、`nnz-mvp-2026-06-24-Step2.6-PostgresScopedCovenant计划.md`、`nnz-mvp-2026-06-24-Step2.7-PostgresScoped剩余表计划.md`、`nnz-mvp-2026-06-25-Step2.8-PostgresIntegration测试计划.md`、`nnz-mvp-2026-06-25-Step2.9-SnapshotToScopedTables迁移预检.md`、`nnz-mvp-2026-06-26-Step2.10-SnapshotDryRunCLI.md`、`nnz-mvp-2026-06-26-Step2.11-ScopedMigrationRows.md`、`nnz-mvp-2026-06-26-Step2.12-ScopedMigrationExecutor.md`、`nnz-mvp-2026-06-26-Step2.13-ExecutorIntegrationHarness.md`、`nnz-mvp-2026-06-26-Step2.14-ExecutorClientTransaction.md`、`nnz-mvp-2026-06-29-Step2.15-StoreSnapshotExportCLI.md`、`nnz-mvp-2026-06-30-Step2.16-SanitizedMigrationSummary.md`、`nnz-mvp-2026-07-01-Step2-MigrationReadinessRoadmap.md`、`nnz-mvp-2026-07-01-Step2.17-ProtectedMigrationExecuteCLI.md`、`nnz-mvp-2026-07-01-Step2.18-MigrationReadinessCLI.md`、`nnz-mvp-2026-07-01-Step2.19-DisposableMigrationSmokeCLI.md`、`nnz-mvp-2026-07-01-Step2.20-RuntimePersistenceModeGuardrail.md`、`nnz-mvp-2026-07-02-Step2.21-MigrationGuardrailHardening.md`、`nnz-mvp-2026-07-03-Step2.22-ScopedRuntimeAdapterFoundation.md`、`nnz-mvp-2026-07-03-Step2.23-ApiMeScopedRuntimeAdapter.md`、`nnz-mvp-2026-07-03-Step2.24-GuardedScopedRuntimePostgresMode.md`、`nnz-mvp-2026-07-03-Step2.25-ScopedRuntimeSmokeGuard.md`、`nnz-mvp-2026-07-03-Step2.26-ScopedOpsCleanupAudit.md`、`nnz-mvp-2026-07-06-Step2.27-ScopedOpsOverview.md`、`nnz-mvp-2026-07-06-Step2.28-UserDataExportDelete.md`、`nnz-mvp-2026-07-06-Step2.29-ScopedRuntimeHttpSmoke.md`、`nnz-mvp-2026-07-06-Step2.30-ScopedRuntimeSmokeSuite.md`、`nnz-mvp-2026-07-06-Step2.31-MigrationValidationSuite.md`、`nnz-mvp-2026-07-06-Step2.32-OpsRoleTokenSmoke.md`、`nnz-mvp-2026-07-07-Step2.33-ReleasePreflight.md`、`nnz-mvp-2026-07-07-Step2.34-ReleaseValidationSuite.md`、`nnz-mvp-2026-07-07-Step2.35-ReleaseEvidence.md`、`nnz-mvp-2026-07-07-Step2.36-SensitiveArtifactIgnore.md` 和 `nnz-mvp-2026-07-07-Step2.37-H5GraduationExport.md`。下一步不是再配置数据库，也不是再拆 `/demo`，也不是再启用 `/ops`，也不是再加基础 audit log/RBAC，也不是再做 audit 查询接口；而是注入外部输入跑 `release:validation-suite -- --evidence-out <sanitized-release-evidence-json>`，再按失败 stage 做 focused diagnosis。

## 16.2.1 2026-06-23 Step 2.5 Postgres scoped repository

已完成最小旁路实现：

- 新增 `src/domain/postgres-scoped-soul-repository.ts`。
- 新增 `ensurePostgresScopedSchema()`，包含 `nnz_users`、`nnz_personas`、`nnz_memory_items`、`nnz_conversation_messages`。
- 新增 `createPostgresScopedSoulRepositoryFromPool()` / `createPostgresScopedSoulRepository()`。
- 新增 `createPostgresUser()`、`createPostgresPersona()`、`listPostgresPersonasForUser()`。
- `PostgresScopedSoulRepository` 当前支持 bound persona、memory、runtime memory、soul-update memory、conversation 读写。
- 测试使用 fake Postgres pool 验证 schema、同名 persona 隔离、跨 owner 拒绝、bound scope 覆盖 caller-supplied ids、memory filter 默认规则。

验证：

```text
npm run typecheck: passed
npm test: 13 个测试文件、84 tests passed
npm run build: passed
```

重要限制：

- 这不是线上迁移；demo runtime 仍使用现有 Postgres snapshot persistence。
- 尚未实现 SoulVersion / Snapshot / Proposal / Node / RuntimeSession 的逐表 Postgres repository。
- 尚未写真实 Postgres 集成测试或数据迁移脚本。

## 16.2.2 2026-06-24 Step 2.6 Postgres scoped Covenant

已完成 Covenant 主链旁路实现：

- 新增 `nnz_soul_versions`、`nnz_soul_snapshots`、`nnz_node_events`、`nnz_runtime_sessions` schema。
- `PostgresScopedSoulRepository` 支持 create/list/get soul version、snapshot、node、runtime session。
- 已实现 `sealSoul()`、`activateNode()`、`completeNode()`、`graduateSoul()`。
- `addConversation({ nodeId })` 已补 node ownership 校验。
- 测试覆盖同 scope ACTIVE 归档、snapshot memoryIds、SEALED/NODE/GRADUATED 状态、同名 active node 复用、完成后新建 node、跨 scope node 拒绝。

验证：

```text
npm run typecheck: passed
npm test: 13 个测试文件、85 tests passed
npm run build:demo: passed
```

重要限制：

- 这仍不是线上迁移；demo runtime 仍使用现有 Postgres snapshot persistence。
- 尚未实现 SoulUpdateProposal / OpsAudit / Credential 的逐表 Postgres repository。
- 尚未写真实 Postgres 集成测试或数据迁移脚本。

## 16.2.3 2026-06-24 Step 2.7 Postgres scoped remaining tables

已完成剩余关键表旁路实现：

- 新增 `nnz_soul_update_proposals`、`nnz_credentials`、`nnz_ops_audit_events` schema。
- `PostgresScopedSoulRepository` 支持 proposal 创建、列表、证据读取、接受、拒绝。
- Proposal evidence 必须来自同 scope 且通过 `listSoulUpdateMemory()` 过滤。
- Credential 支持 `storeCredential()` / `getCredentialByEmail()`。
- OpsAuditEvent 支持 `recordOpsAuditEvent()` / `listOpsAuditEvents()`。
- 测试覆盖 cross-scope evidence 拒绝、node/restricted evidence 拒绝、proposal terminal 状态、credential user 绑定、audit metadata 不含 credential/chat 敏感内容。

验证：

```text
npm run typecheck: passed
npm test: 13 个测试文件、87 tests passed
npm run build:demo: passed
```

重要限制：

- 这仍不是线上迁移；demo runtime 仍使用现有 Postgres snapshot persistence。
- 尚未写真实 Postgres 集成测试或数据迁移脚本。

## 16.2.4 2026-06-25 Step 2.8 Postgres integration test harness

已完成 opt-in 真实 Postgres integration test：

- 新增 `src/domain/postgres-scoped-soul-repository.integration.test.ts`。
- 只读取 `NNZ_POSTGRES_INTEGRATION_URL`，不会使用 `DATABASE_URL` 或 `NNZ_POSTGRES_URL`。
- 默认 `npm test` 会 skip；有一次性测试库时才连接执行。
- 覆盖 schema 创建、JSONB round-trip、复合外键拒绝跨 scope snapshot / memory、cross-scope evidence/node 拒绝、user 删除后的级联删除、OpsAudit 全局保留。

验证：

```text
npm run typecheck: passed
npm test: 13 个测试文件、87 tests passed；1 个 integration 文件 skipped
npm run build:demo: passed
git diff --check: passed
```

重要限制：

- 尚未连接真实测试库跑 opt-in integration。
- 这仍不是线上迁移；demo runtime 仍使用现有 Postgres snapshot persistence。
- 下一步是用一次性测试库实际运行 integration test，并用真实 `StoreSnapshot` 样本跑 Step 2.9 planner。

## 16.2.5 2026-06-25 Step 2.9 snapshot -> scoped tables migration planner

已完成离线迁移预检 planner：

- 新增 `src/domain/postgres-scoped-migration-plan.ts`。
- 新增 `src/domain/postgres-scoped-migration-plan.test.ts`。
- `planPostgresScopedMigration(snapshot)` 输入 `StoreSnapshot`，输出 scoped table order、每表 row count、total rows、blocking errors 和 warnings。
- 校验 Soul / Memory / Snapshot / Node / Conversation / Session / Proposal 都能回到同一个 `userId + personaId`。
- 校验 snapshot -> SoulVersion / Memory、proposal -> evidence、conversation/session -> node 的同 scope 引用。
- 校验 credential 绑定存在 user，且 user/email 不重复。
- 校验每个 scope 最多一个 ACTIVE SoulVersion。
- OpsAudit 作为后台全局表，target user 缺失只输出 warning，不阻断迁移。
- Session 校验兼容当前 `store.serialize()` 的 `nodeContext` 形态和旧扁平 `nodeId` / `nodeName` 形态。

验证：

```text
npm run typecheck: passed
npm test -- src/domain/postgres-scoped-migration-plan.test.ts --reporter verbose: 3 tests passed
npm test: 14 个测试文件、90 tests passed；1 个 integration 文件 skipped
npm run build:demo: passed
```

重要限制：

- 这仍不是线上迁移；planner 不读取 `DATABASE_URL`，不连接 Render，不执行 INSERT / DELETE / UPDATE。
- 尚未用真实线上 `StoreSnapshot` 样本跑 dry-run plan。
- 下一步必须先审阅真实 snapshot 的 errors / warnings / row count，再设计实际迁移执行器。

## 16.2.6 2026-06-26 Step 2.10 snapshot migration dry-run CLI

已完成本地 dry-run CLI：

- 新增 `src/tools/postgres-scoped-migration-plan-cli.ts`。
- 新增 `src/tools/postgres-scoped-migration-plan-cli.test.ts`。
- `package.json` 新增 `migration:plan` script。
- 支持原始 `StoreSnapshot` JSON、`snapshot_json` wrapper、`rows[0].snapshot_json` wrapper。
- 默认输出人类可读 row count / warnings / errors；`--json` 输出完整 `PostgresScopedMigrationPlan`。
- `--report` 输出 sanitized JSON report，只含 counts、issue code、table 和 id，不含 memory / chat 正文。
- 退出码：0 表示 ready，1 表示 CLI/JSON 错误，2 表示 planner blocking errors。
- script 使用 `node --import tsx`，避免当前沙盒下 `tsx` CLI 创建 IPC pipe 时的 `EPERM`。

使用：

```text
npm run migration:plan -- <snapshot-json-path>
npm run migration:plan -- --json <snapshot-json-path>
npm run migration:plan -- --report <report-json-path> <snapshot-json-path>
```

验证：

```text
npm run typecheck: passed
npm test -- src/tools/postgres-scoped-migration-plan-cli.test.ts --reporter verbose: 7 tests passed
npm run migration:plan -- --help: passed
npm run migration:plan -- /tmp/nnz-migration-snapshot.json: passed
npm run migration:plan -- --report /tmp/nnz-migration-report.json /tmp/nnz-migration-sensitive-snapshot.json: passed
sanitized report content check: passed, no sensitive memory/chat text
npm test: 15 个测试文件、97 tests passed；1 个 integration 文件 skipped
npm run build:demo: passed
git diff --check: passed
```

重要限制：

- 这仍不是线上迁移；CLI 只读本地 JSON 文件，不读取数据库环境变量，不连接 Render，不写入任何数据库。
- 尚未用真实线上 `StoreSnapshot` 样本跑 dry-run plan。
- 下一步仍是一次性 Postgres integration run + 真实 snapshot dry-run 审阅。

## 16.2.7 2026-06-26 Step 2.11 scoped migration row builder

已完成离线 row builder：

- 新增 `src/domain/postgres-scoped-migration-rows.ts`。
- 新增 `src/domain/postgres-scoped-migration-rows.test.ts`。
- `buildPostgresScopedMigrationRows(snapshot)` 会先运行 Step 2.9 planner；如果存在 blocking errors，会抛出 `PostgresScopedMigrationRowsError`，不生成 rows。
- 输出按 `POSTGRES_SCOPED_MIGRATION_TABLE_ORDER` 排列的 table rows 和 totalRows，为后续 write-side migration executor 做准备。
- 覆盖 users/personas、soul_versions/soul_snapshots、memory/conversation、node/runtime session、proposal、credential、ops audit。
- NODE session 的 `nodeContext` 会展平为 `node_id` / `node_name`。
- Step 2.10 `--report` 已实际调用 row builder，但 sanitized report 只输出 rowBuild counts，不输出 rows 或敏感正文。

验证：

```text
npm run typecheck: passed
npm test -- src/domain/postgres-scoped-migration-rows.test.ts src/tools/postgres-scoped-migration-plan-cli.test.ts --reporter verbose: 10 tests passed
npm run migration:plan -- --report /tmp/nnz-migration-row-builder-report.json /tmp/nnz-migration-row-builder-snapshot.json: passed
rowBuild sanitized report content check: passed, no rows / sensitive memory / sensitive chat text
npm test: 16 个测试文件、100 tests passed；1 个 integration 文件 skipped
npm run build:demo: passed
git diff --check: passed
```

重要限制：

- 这仍不是线上迁移；row builder 只构造内存 rows，不连接 Render，不写入任何数据库。
- 尚未用真实线上 `StoreSnapshot` 样本跑 dry-run / rowBuild。
- 下一步仍是一次性 Postgres integration run + 真实 snapshot dry-run 审阅，再设计 write-side migration executor。

## 16.2.8 2026-06-26 Step 2.12 scoped migration executor core

已完成 write-side executor core：

- 新增 `src/domain/postgres-scoped-migration-executor.ts`。
- 新增 `src/domain/postgres-scoped-migration-executor.test.ts`。
- `executePostgresScopedMigration(pool, snapshot, options)` 必须显式传入 `confirm: EXECUTE_POSTGRES_SCOPED_MIGRATION_CONFIRM`，否则不会执行任何 query。
- 默认执行 `BEGIN` -> `ensurePostgresScopedSchema(pool)` -> 按 row builder 顺序 insert/upsert -> `COMMIT`。
- 任意 row insert 失败会执行 `ROLLBACK`。
- `ensureSchema:false` 可用于调用方已确保 schema 的场景。
- 普通 scoped tables 使用 `ON CONFLICT ... DO UPDATE` 支持幂等重跑；OpsAudit 使用 `ON CONFLICT DO NOTHING`，避免覆盖既有审计事件。
- Step 2.10 sanitized report 新增 executor section，标记 readyForExecution、executed:false、requiredConfirm，但不会执行迁移。

验证：

```text
npm run typecheck: passed
npm test -- src/domain/postgres-scoped-migration-executor.test.ts src/tools/postgres-scoped-migration-plan-cli.test.ts --reporter verbose: 11 tests passed
npm test: 17 个测试文件、104 tests passed；2 个 integration 文件 skipped
npm run build:demo: passed
git diff --check: passed
```

重要限制：

- 这仍不是线上迁移；当时没有 CLI 执行入口，不读取 `DATABASE_URL`，不连接 Render；后续 Step 2.17 已补本地 protected CLI。
- disposable database integration harness 已在 Step 2.13 补齐，但尚未提供一次性 Postgres URL 实跑。
- 下一步应先用 disposable database 跑 repository/executor integration，再考虑任何受保护的执行入口。

## 16.2.9 2026-06-26 Step 2.13 executor disposable DB integration harness

已完成 opt-in executor integration harness：

- 新增 `src/domain/postgres-scoped-migration-executor.integration.test.ts`。
- 只读取 `NNZ_POSTGRES_INTEGRATION_URL`，不会使用 `DATABASE_URL` 或 `NNZ_POSTGRES_URL`。
- 默认 `npm test` 会 skip；有一次性测试库时才连接执行。
- 构造双 user / 双 persona 的 `StoreSnapshot`，调用 `executePostgresScopedMigration(...)` 两次验证幂等。
- 通过 `PostgresScopedSoulRepository` 读回 runtime session、snapshot、memory、conversation、proposal、credential。
- 覆盖 cross-scope node conversation 拒绝、user 删除级联清理、OpsAudit 全局表单独清理。

验证：

```text
npm run typecheck: passed
npm test -- src/domain/postgres-scoped-migration-executor.test.ts src/domain/postgres-scoped-migration-executor.integration.test.ts --reporter verbose: 4 tests passed；1 个 integration test skipped
npm test: 17 个测试文件、104 tests passed；2 个 integration 文件 skipped
npm run build:demo: passed
```

重要限制：

- 这仍不是线上迁移；当时没有 CLI 执行入口，不读取 `DATABASE_URL`，不连接 Render；后续 Step 2.17 已补本地 protected CLI。
- 尚未连接一次性 Postgres 测试库实跑 repository/executor integration。
- 下一步是设置 `NNZ_POSTGRES_INTEGRATION_URL` 后运行 `src/domain/postgres-scoped-soul-repository.integration.test.ts` 和 `src/domain/postgres-scoped-migration-executor.integration.test.ts`。

## 16.2.10 2026-06-26 Step 2.14 executor client-bound transaction

已修正 executor 事务边界：

- `executePostgresScopedMigration(...)` 现在要求 pool 支持 `connect()`。
- executor 通过 checked-out client 执行 `BEGIN` / schema / ordered inserts / `COMMIT`。
- 失败路径在同一 client 上执行 `ROLLBACK`。
- 成功和失败路径都会 `release()` client。
- repository 类型拆分为 `QueryableClient` 与 `QueryablePool`，让 `ensurePostgresScopedSchema(...)` 可在 transaction client 内执行。
- fake pool 测试验证 transaction SQL 不再走 pool 直接 query，而是走同一个 leased client。

验证：

```text
npm test -- src/domain/postgres-scoped-migration-executor.test.ts --reporter verbose: 4 tests passed
npm run typecheck: passed
```

重要限制：

- 这仍不是线上迁移；当时没有 CLI 执行入口，不读取 `DATABASE_URL`，不连接 Render；后续 Step 2.17 已补本地 protected CLI。
- 尚未连接一次性 Postgres 测试库实跑 repository/executor integration。

## 16.2.11 2026-06-29 Step 2.15 StoreSnapshot export CLI

已完成离线 snapshot export CLI：

- 新增 `src/tools/store-snapshot-export-cli.ts`。
- 新增 `src/tools/store-snapshot-export-cli.test.ts`。
- `package.json` 新增 `snapshot:export` script。
- 支持 `--from-sqlite <sqlite-db-path> --out <snapshot-json-path>`，从显式本地 SQLite demo persistence 导出。
- 支持 `--from-json <snapshot-or-wrapper-json-path> --out <snapshot-json-path>`，接受 raw `StoreSnapshot`、`snapshot_json` wrapper、`rows[0].snapshot_json` wrapper。
- 默认拒绝覆盖输出文件；`--force` 才覆盖。
- stdout 只打印 counts 和下一步命令，不打印 memory/chat/credential hash。
- 输出 JSON 是完整原始 snapshot，包含敏感数据，必须留在本地。

验证：

```text
npm test -- src/tools/store-snapshot-export-cli.test.ts src/tools/postgres-scoped-migration-plan-cli.test.ts --reporter verbose: 12 tests passed
npm run typecheck: passed
npm run snapshot:export -- --from-json /tmp/nnz-export-smoke-input.json --out /tmp/nnz-export-smoke-output.json --force: passed
npm run migration:plan -- --report /tmp/nnz-export-smoke-report.json /tmp/nnz-export-smoke-output.json: passed
sanitized report content check: passed, no smoke memory/chat text
npm test: 18 个测试文件、109 tests passed；2 个 integration 文件 skipped
npm run build:demo: passed
git diff --check: passed
```

重要限制：

- 这仍不是线上迁移；不读取 `DATABASE_URL` / `NNZ_POSTGRES_URL`，不连接 Render。
- `snapshot:export` 输出的是完整敏感 snapshot；审阅应使用 `migration:plan -- --report` 的 sanitized report。

## 16.2.12 2026-06-30 Step 2.16 sanitized migration summary

已完成 sanitized summary：

- `src/tools/postgres-scoped-migration-plan-cli.ts` 新增 `--summary`。
- `createSanitizedReport(...)` 新增 `summary` 字段。
- 新增 `createSanitizedSummary(...)` helper。
- `--summary` 与 `--json` 互斥。
- summary 只输出 ready、row count、warning/error count、code/table 聚合、nextAction。
- summary 不输出 issue message、row id、用户 id、email、memory/chat 正文。

验证：

```text
npm test -- src/tools/postgres-scoped-migration-plan-cli.test.ts --reporter verbose: 10 tests passed
npm run typecheck: passed
npm run migration:plan -- --summary /tmp/nnz-summary-smoke.json: passed with expected exit code 2
sanitized summary content check: passed, no test memory/chat/user id
npm test: 18 个测试文件、112 tests passed；2 个 integration 文件 skipped
npm run build:demo: passed
git diff --check: passed
```

重要限制：

- 这仍不是线上迁移；不读取 `DATABASE_URL`，不连接 Render。
- summary 是给审阅用的聚合视图；具体修复仍需在本地查看 raw snapshot 或 sanitized report。

## 16.2.13 2026-07-01 Step 2.17 protected migration execution CLI

已完成受保护执行入口：

- 新增 `src/tools/postgres-scoped-migration-execute-cli.ts`。
- 新增 `src/tools/postgres-scoped-migration-execute-cli.test.ts`。
- `package.json` 新增 `migration:execute` script。
- 默认模式是 dry-run：只读显式 `--snapshot` 文件，输出 sanitized counts，不创建 pool，不连接 Postgres。
- 执行模式必须同时传 `--execute`、`--database-url-env NNZ_POSTGRES_INTEGRATION_URL`、`--confirm EXECUTE_POSTGRES_SCOPED_MIGRATION`。
- CLI 明确拒绝 `DATABASE_URL` / `NNZ_POSTGRES_URL`，只允许 disposable DB env。
- blocking errors 会拒绝执行；warnings 默认拒绝执行，审阅后才可显式 `--allow-warnings`。
- stdout/report 不输出 rows、memory/chat 正文、credential hash、数据库 URL 或原始数据库错误详情。

命令：

```bash
npm run migration:execute -- --snapshot <snapshot-json-path>
npm run migration:execute -- --snapshot <snapshot-json-path> --execute --database-url-env NNZ_POSTGRES_INTEGRATION_URL --confirm EXECUTE_POSTGRES_SCOPED_MIGRATION
```

验证：

```text
npm test -- src/tools/postgres-scoped-migration-execute-cli.test.ts src/tools/postgres-scoped-migration-plan-cli.test.ts src/domain/postgres-scoped-migration-executor.test.ts --reporter verbose: 20 tests passed
npm run typecheck: passed
npm test: 19 个测试文件、118 tests passed；2 个 integration 文件 skipped
npm run build:demo: passed
npm run migration:execute -- --help: passed
```

重要限制：

- 这仍不是线上迁移；真实执行只能用于 disposable DB。
- 尚未用真实 `NNZ_POSTGRES_INTEGRATION_URL` 实跑 protected execution smoke。
- 尚未用真实本地 snapshot 串起 `migration:readiness` -> `migration:execute`。

## 16.2.14 2026-07-01 Step 2.18 migration readiness CLI

已完成一键 readiness 编排：

- 新增 `src/tools/postgres-scoped-migration-readiness-cli.ts`。
- 新增 `src/tools/postgres-scoped-migration-readiness-cli.test.ts`。
- `package.json` 新增 `migration:readiness` script。
- 支持 `--from-json <snapshot-or-wrapper-json-path>`。
- 支持 `--from-sqlite <sqlite-db-path>`。
- 一次生成 `--snapshot-out` raw snapshot、`--report-out` sanitized report、`--summary-out` sanitized summary。
- 默认拒绝覆盖输出文件；`--force` 才覆盖。
- 拒绝输出路径重复，拒绝输出路径覆盖输入路径。
- 不读取 `DATABASE_URL` / `NNZ_POSTGRES_URL` / `NNZ_POSTGRES_INTEGRATION_URL`，不连接 Postgres。
- raw snapshot 可能含 memory/chat/credential hash，必须留在本地；report/summary 不含 memory/chat 正文、credential hash 或 rows。

命令：

```bash
npm run migration:readiness -- --from-json <snapshot-or-wrapper-json-path> --snapshot-out <raw-snapshot-json-path> --report-out <sanitized-report-json-path> --summary-out <sanitized-summary-json-path>
npm run migration:readiness -- --from-sqlite <sqlite-db-path> --snapshot-out <raw-snapshot-json-path> --report-out <sanitized-report-json-path> --summary-out <sanitized-summary-json-path>
```

验证：

```text
npm test -- src/tools/postgres-scoped-migration-readiness-cli.test.ts src/tools/postgres-scoped-migration-plan-cli.test.ts src/tools/postgres-scoped-migration-execute-cli.test.ts src/tools/store-snapshot-export-cli.test.ts --reporter verbose: 27 tests passed
npm run typecheck: passed
npm test: 20 个测试文件、124 tests passed；2 个 integration 文件 skipped
npm run build:demo: passed
npm run migration:readiness -- --help: passed
```

重要限制：

- 真实 snapshot readiness 仍未实跑，因为当前没有本地 SQLite / StoreSnapshot JSON 路径。
- disposable DB integration 和 protected execution smoke 仍未实跑，因为当前没有 `NNZ_POSTGRES_INTEGRATION_URL`。

## 16.2.15 2026-07-01 Step 2.19 disposable migration smoke CLI

已完成一次性 Postgres smoke 命令：

- 新增 `src/tools/postgres-scoped-migration-smoke-cli.ts`。
- 新增 `src/tools/postgres-scoped-migration-smoke-cli.test.ts`。
- `package.json` 新增 `migration:smoke` script。
- 必须传 `--database-url-env NNZ_POSTGRES_INTEGRATION_URL`。
- 必须传 `--confirm RUN_POSTGRES_SCOPED_MIGRATION_SMOKE`。
- 明确拒绝 `DATABASE_URL` / `NNZ_POSTGRES_URL`。
- 构造双 user / 双 persona fixture snapshot。
- 执行 scoped migration 两次，验证幂等。
- 通过 `PostgresScopedSoulRepository` 读回 runtime session、snapshot、memory、conversation、proposal、credential。
- 验证 cross-scope node conversation 拒绝、OpsAudit row 写入、user delete cascade、sibling scope preserved。
- finally 中清理 fixture users 和 audit rows。
- stdout 和失败输出不含 DB URL、fixture memory/chat、credential hash、row payload 或 raw DB error details。

命令：

```bash
npm run migration:smoke -- --database-url-env NNZ_POSTGRES_INTEGRATION_URL --confirm RUN_POSTGRES_SCOPED_MIGRATION_SMOKE
```

验证：

```text
npm test -- src/tools/postgres-scoped-migration-smoke-cli.test.ts src/tools/postgres-scoped-migration-execute-cli.test.ts src/tools/postgres-scoped-migration-readiness-cli.test.ts src/domain/postgres-scoped-migration-executor.test.ts --reporter verbose: 21 tests passed
npm run typecheck: passed
npm test: 21 个测试文件、129 tests passed；2 个 integration 文件 skipped
npm run build:demo: passed
npm run migration:smoke -- --help: passed
```

重要限制：

- 真实 disposable DB smoke 仍未实跑，因为当前没有 `NNZ_POSTGRES_INTEGRATION_URL`。
- 真实 snapshot readiness 仍未实跑，因为当前没有本地 SQLite / StoreSnapshot JSON 路径。

## 16.2.16 2026-07-01 Step 2.20 runtime persistence mode guardrail

已完成 demo runtime 持久化模式护栏：

- 新增 `src/runtime-persistence-config.ts`。
- 新增 `src/runtime-persistence-config.test.ts`。
- `src/demo-server.ts` 改为通过 `buildRuntimePersistenceConfig(process.env)` 选择持久化配置。
- 默认 `NNZ_RUNTIME_PERSISTENCE_MODE` 为空或 `snapshot`，保持原有 Postgres snapshot / SQLite / memory 行为。
- snapshot 模式仍按 `NNZ_POSTGRES_URL` 优先、`DATABASE_URL` 其次选择 Postgres snapshot URL。
- 新增未来 scoped runtime 专用 env：`NNZ_RUNTIME_PERSISTENCE_MODE=scoped` + `NNZ_POSTGRES_SCOPED_RUNTIME_URL`。
- scoped 模式明确忽略 `DATABASE_URL` / `NNZ_POSTGRES_URL`，并且当时在真正 adapter 完成前 fail-fast，避免误切线上运行时；后续 Step 2.24 已接到 Postgres scoped runtime adapter，缺专用 URL 仍 fail-fast。
- `/healthz` persistence 诊断新增 `runtimeMode`、`requestedRuntimeMode`、`scopedPostgresConfigured`、`scopedPostgresEnv`、`startupBlocked`、`startupBlockReason`。
- Soul Ops overview 的 persistence info 同步新增这些字段。
- 诊断只返回 env key、boolean 和非敏感状态原因，不返回 URL、token、memory/chat 正文或 row payload。

验证：

```text
npm test -- src/runtime-persistence-config.test.ts src/ops/ops-console.test.ts --reporter verbose: 10 tests passed
npm run typecheck: passed
npm test: 22 个测试文件、134 tests passed；2 个 integration 文件 skipped
npm run build:demo: passed
git diff --check: passed
```

重要限制：

- 这一步当时不是 runtime scoped-table adapter；后续 Step 2.24 已把 `NNZ_RUNTIME_PERSISTENCE_MODE=scoped` 接到 Postgres scoped runtime adapter。
- 默认线上/本地运行路径仍是 snapshot persistence 或 SQLite/memory。
- 下一步实现 adapter 时仍必须保持每条 Soul/Memory/Snapshot/Node/Conversation/Session/Proposal 访问携带 `userId + personaId`。

## 16.2.17 2026-07-02 Step 2.21 migration guardrail hardening

按产品进程审计补强了两个受保护入口：

- 新增 `src/tools/postgres-disposable-env-guard.ts`。
- `migration:execute` 和 `migration:smoke` 共用 disposable DB env value guard。
- 即使命令参数正确传了 `--database-url-env NNZ_POSTGRES_INTEGRATION_URL`，只要 `NNZ_POSTGRES_INTEGRATION_URL` 的值与 `DATABASE_URL` 或 `NNZ_POSTGRES_URL` 相同，就拒绝执行。
- 拒绝信息只打印 env key，不打印任何 URL 值。
- `migration:smoke` 的 `pool.end()` close failure 改为固定脱敏输出，不再可能冒出 raw database details。
- `migration:execute` 同步修复同类 close failure 风险。
- 新增测试覆盖 production alias value conflict、trim 后比较、close failure raw detail 不泄露。

验证：

```text
npm test -- src/tools/postgres-scoped-migration-smoke-cli.test.ts src/tools/postgres-scoped-migration-execute-cli.test.ts --reporter verbose: 15 tests passed
npm run typecheck: passed
npm test: 22 个测试文件、138 tests passed；2 个 integration 文件 skipped
npm run build:demo: passed
git diff --check: passed
```

重要限制：

- 这仍未实跑真实 disposable DB；需要外部提供一次性 `NNZ_POSTGRES_INTEGRATION_URL`。
- 这不是新增 migration CLI；只是修补现有 `migration:execute` / `migration:smoke` 的生产误连与错误脱敏边界。

## 16.2.18 2026-07-03 Step 2.22 scoped runtime adapter foundation

已完成 demo runtime scoped-table 切换前的适配器地基：

- 新增 `src/runtime/scoped-runtime-adapter.ts`。
- 新增 `src/runtime/scoped-runtime-adapter.test.ts`。
- 建立 `ScopedRuntimeAdapter`，把全局 user / credential / persona 操作和绑定 `userId + personaId` 的 runtime 操作分开。
- `createInMemoryScopedRuntimeAdapter(store)` 包住现有 `InMemorySoulStore`，用于保持默认 snapshot / memory runtime 路径的行为语义。
- `createPostgresScopedRuntimeAdapter(pool)` 包住 `PostgresScopedSoulRepository`，并补齐 user/persona/credential 的逐表 helper。
- `ScopedPersonaRuntimeAdapter` 覆盖 persona、SoulVersion、Memory、Conversation、Node、RuntimeSession、RuntimeContext、seal/activate/complete/graduate。
- `getRuntimeContext()` 保持 Covenant 行为：`SEALED` / `GRADUATED` 抛 `CovenantStateError`；`NODE` 从同 scope snapshot + active node memory 重建上下文；`ACTIVE` 使用 latest active soul + runtime memory。
- fake Postgres pool 测试覆盖 credential SQL mapping、bound scope、以及调用记录不包含数据库 URL。

验证：

```text
npm test -- src/runtime/scoped-runtime-adapter.test.ts --reporter verbose: 3 tests passed
npm run typecheck: passed
npm test: 141 tests passed；2 个 integration 文件 skipped
npm run build:demo: passed
git diff --check: passed
```

重要限制：

- 这一步本身不是 demo runtime cutover；后续 Step 2.23 已先把 `/api/me/*` 接到 InMemory adapter。
- `NNZ_RUNTIME_PERSISTENCE_MODE=scoped` 仍应保持受保护；Postgres scoped adapter runtime、cleanup/audit/overview、export/delete 已完成本地接入，真实 disposable DB smoke 仍待执行。
- 尚未实跑真实 disposable DB 或真实 Render scoped runtime。

## 16.2.19 2026-07-03 Step 2.23 `/api/me/*` scoped runtime adapter wiring

已完成用户端 flow 的 adapter 形状切换：

- `src/demo-server.ts` 引入 `createInMemoryScopedRuntimeAdapter(fixture.store)`。
- `/api/register` / `/api/login` 的 credential 查询、写入走 `ScopedRuntimeAdapter`。
- `/api/me` / `/api/me/personas` 通过 adapter 列出当前用户 personas，并用 bound runtime adapter 统计 memory/message。
- `/api/me/persona` 通过 adapter 创建 persona、SoulVersion 和 DESCRIPTION memory。
- `/api/me/chat-history` / `/api/me/chat` 通过 bound `ScopedPersonaRuntimeAdapter` 读取 persona、conversation、runtime context，并写入 user/assistant conversation。
- `/api/me/covenant-state`、`/api/me/seal`、`/api/me/activate-node`、`/api/me/complete-node`、`/api/me/graduate` 通过 bound adapter 读取或切换 Covenant state。
- A/B 开发者 demo、Ops overview/cleanup/audit、snapshot persistence 仍保留原 store 路径，避免一次性扩大切换面。

验证：

```text
npm run typecheck: passed
npm test: 23 个测试文件、141 tests passed；2 个 integration 文件 skipped
npm run build:demo: passed
本地 API smoke: register -> persona create -> chat -> chat-history -> seal -> activate-node -> complete-node passed；reply no mechanism leak
```

重要限制：

- 默认 runtime persistence 仍是 snapshot/Postgres JSONB 或 SQLite/memory；这一步没有启用 scoped Postgres runtime。
- 后续 Step 2.24 已把 `NNZ_RUNTIME_PERSISTENCE_MODE=scoped` 接入 Postgres scoped runtime adapter；仍需真实 disposable DB smoke。
- Ops cleanup/audit/overview 与用户 export/delete 后续已通过 scoped runtime / repository 层收口；真实 scoped Postgres HTTP smoke 仍待执行。

## 16.2.20 2026-07-03 Step 2.24 guarded scoped runtime Postgres mode

已完成 guarded scoped runtime mode 接线：

- 新增 `src/runtime/scoped-runtime-persistence.ts`。
- 新增 `src/runtime/scoped-runtime-persistence.test.ts`。
- `src/runtime-persistence-config.ts` 现在允许 `NNZ_RUNTIME_PERSISTENCE_MODE=scoped` 在提供 `NNZ_POSTGRES_SCOPED_RUNTIME_URL` 时启动；缺专用 URL 仍 fail-fast，并继续忽略 `DATABASE_URL` / `NNZ_POSTGRES_URL`。
- `src/demo-server.ts` 在 scoped mode 下创建 scoped runtime persistence，先确保 scoped schema，再把 `/api/me/*` runtime adapter 指向 Postgres scoped tables。
- scoped mode 下 `persistIfEnabled()` 不再写旧 snapshot store；用户端写入由 Postgres scoped adapter 处理。
- scoped mode 下暂不运行旧 extraction orchestrator，避免把 Postgres conversation 交给 InMemory extraction 管线。
- `/healthz` / Ops persistence diagnostic 可显示 `mode: "scoped-postgres"` 和 `runtimeMode: "scoped"`，仍只暴露 env key / boolean。

验证：

```text
npm test -- src/runtime/scoped-runtime-persistence.test.ts src/runtime-persistence-config.test.ts --reporter verbose: 6 tests passed
npm run typecheck: passed
npm test: 24 个测试文件、142 tests passed；2 个 integration 文件 skipped
npm run build:demo: passed
默认内存模式 /api/me smoke: register/persona/chat/history/seal/activate/complete passed；reply no mechanism leak
scoped mode missing URL smoke: fail-fast passed；错误只提 NNZ_POSTGRES_SCOPED_RUNTIME_URL / DATABASE_URL / NNZ_POSTGRES_URL env key
```

重要限制：

- 尚未连接真实 disposable `NNZ_POSTGRES_SCOPED_RUNTIME_URL` 做 `/api/me/*` scoped Postgres smoke。
- Ops cleanup/audit/overview 与用户 export/delete 后续已切到 scoped runtime / repository 层；仍需真实 disposable `NNZ_POSTGRES_SCOPED_RUNTIME_URL` 做 scoped Postgres smoke。
- scoped mode 暂不运行 extraction pipeline；后续需要为 scoped repository 增加 proposal/evidence/extraction flow 后再开启。

## 16.2.21 2026-07-03 Step 2.25 scoped runtime smoke guard

已完成 scoped runtime 切换前的防护和烟测入口：

- 新增 `src/postgres-env-alias-guard.ts`，把生产 Postgres env alias value guard 抽成通用模块。
- `src/tools/postgres-disposable-env-guard.ts` 继续提供 migration smoke/execute 旧接口，但底层复用通用 guard。
- `src/runtime-persistence-config.ts` 现在会拒绝 `NNZ_POSTGRES_SCOPED_RUNTIME_URL` 与 `DATABASE_URL` / `NNZ_POSTGRES_URL` 同值的生产别名误配。
- 新增 `src/tools/postgres-scoped-runtime-smoke-cli.ts` / `.test.ts`。
- `package.json` 新增 `runtime:smoke` script。

`runtime:smoke` 命令：

```text
npm run runtime:smoke -- --database-url-env NNZ_POSTGRES_SCOPED_RUNTIME_URL --confirm RUN_POSTGRES_SCOPED_RUNTIME_SMOKE
```

验证范围：

- ensure scoped schema。
- 通过 scoped runtime adapter 创建两组 user/persona fixture。
- 验证 credential、persona list、runtime context 读回。
- 验证 ACTIVE -> SEALED -> NODE -> SEALED 与 sibling GRADUATED。
- 验证 cross-scope node conversation 拒绝。
- 验证 user delete cascade 与 sibling scope preserved。
- finally 尝试清理 fixture users。

安全边界：

- 只允许 `NNZ_POSTGRES_SCOPED_RUNTIME_URL`，拒绝 `DATABASE_URL`。
- 如果 `NNZ_POSTGRES_SCOPED_RUNTIME_URL` 与 `DATABASE_URL` / `NNZ_POSTGRES_URL` 同值则拒绝。
- stdout/失败输出不含 DB URL、fixture memory/chat、credential hash、row payload 或 raw database error details。

验证：

```text
npm test -- src/runtime-persistence-config.test.ts src/tools/postgres-scoped-runtime-smoke-cli.test.ts src/tools/postgres-scoped-migration-smoke-cli.test.ts --reporter verbose: 21 tests passed
npm run typecheck: passed
npm run runtime:smoke -- --help: passed
npm test: 25 个测试文件、151 tests passed；2 个 integration 文件 skipped
npm run build:demo: passed
```

## 16.2.22 2026-07-03 Step 2.26 scoped Ops cleanup/audit cutover

已完成 scoped mode 下 Ops cleanup/audit 的第一段切换：

- 新增 `src/ops/postgres-scoped-ops-store.ts`。
- 新增 `src/ops/postgres-scoped-ops-store.test.ts`。
- `src/runtime/scoped-runtime-persistence.ts` 暴露同 pool 的 `ops` store。
- `src/demo-server.ts` 在 scoped mode 下把 Ops cleanup dry-run/confirm、Ops audit write/query 接到 scoped Postgres tables。
- snapshot / SQLite / JSONB snapshot 模式仍走原 `InMemorySoulStore` Ops helper。

scoped Ops store 覆盖：

- `buildTestUserCleanupPlan()` 从 `nnz_users` + `nnz_credentials` 找 explicit smoke/test accounts。
- `cleanupTestUsers(true)` 保持 read-only。
- `cleanupTestUsers(false)` 删除计划内 test users，并返回 receipts。
- 删除通过 `DELETE FROM nnz_users WHERE id = $1` 触发 scoped FK cascade。
- cleanup counts 使用 scoped table joins，避免 persona-only 查询。
- `recordOpsAuditEvent()` 写入 `nnz_ops_audit_events`。
- `queryOpsAuditEvents()` 支持 action / actor / targetUserId / limit / offset。

重要限制：

- scoped mode full Ops overview 的 user/persona maturity 大表尚未切完；当前只替换 cleanup plan 与 audit overview。
- 用户级 export/delete API 后续已在 Step 2.28 实现 scoped cutover。
- 仍需真实 disposable `NNZ_POSTGRES_SCOPED_RUNTIME_URL` 跑 `runtime:smoke` 和 `/api/me/*` scoped Postgres HTTP smoke。

验证：

```text
npm test -- src/ops/postgres-scoped-ops-store.test.ts src/runtime/scoped-runtime-persistence.test.ts src/ops/ops-console.test.ts --reporter verbose: 9 tests passed
npm run typecheck: passed
npm test: 26 个测试文件、154 tests passed；2 个 integration 文件 skipped
npm run build:demo: passed
```

## 16.2.23 2026-07-06 Step 2.27 scoped Ops overview aggregation

已完成 scoped mode 下 `/api/ops/overview` 的 users/personas/maturity 聚合切换：

- `src/ops/postgres-scoped-ops-store.ts` 新增 `buildOverview(persistence)`。
- overview 从 scoped Postgres tables 读取 users/personas/soul_versions/snapshots/memory/proposals/nodes/conversations/sessions/credentials/audit。
- 后台内部重建临时 `InMemorySoulStore` snapshot，并复用现有 `buildOpsOverview()` 与 Soul maturity 算法。
- `src/demo-server.ts` scoped mode 下 `/api/ops/overview` 不再从 demo fixture store 聚合 users/personas/maturity。
- snapshot / SQLite / JSONB snapshot mode 行为不变。

安全边界：

- 读取路径仍以 `userId + personaId` 组织 scoped rows；没有引入 persona-only owner 查询。
- overview 返回摘要、counts、maturity、audit，不返回 memory/chat 正文或 credential hash。
- JSONB scalar string 兼容普通 JS string 与 JSON string，避免真实 pg 行为差异导致 overview 失败。

验证：

```text
npm test -- src/ops/postgres-scoped-ops-store.test.ts --reporter verbose: 4 tests passed
npm run typecheck: passed
npm test: 26 个测试文件、155 tests passed；2 个 integration 文件 skipped
npm run build:demo: passed
```

## 16.2.24 2026-07-06 Step 2.28 user data export/delete cutover

已完成用户数据主权接口的 scoped adapter 收口：

- `src/runtime/scoped-runtime-adapter.ts` 新增 `UserDataExport`、`exportUserData(userId)` 和 `deleteUserData(userId)`。
- InMemory adapter 通过现有 store 的 scope-safe list 方法导出当前用户数据，再调用 `deleteUserScopedData(userId)` 删除。
- Postgres scoped adapter 先列出当前用户 personas，再按每个 `{ userId, personaId }` 绑定 repository 读取 SoulVersion、SoulSnapshot、Memory、Proposal、Node、Conversation 和 RuntimeSession；没有引入 persona-only 查询。
- Postgres scoped 删除通过 `DELETE FROM nnz_users WHERE id = $1` 触发 scoped FK cascade，只删除当前登录用户。
- `src/demo-server.ts` 新增 `GET /api/me/export` 和 `POST /api/me/delete`；删除需要 `confirm:"DELETE_MY_DATA"`。
- `public/index.html` 登录态新增“导出”和“删除全部数据”入口。
- `InMemorySoulStore`、`ScopedSoulRepository`、`PostgresScopedSoulRepository` 补了 scope-safe `listSoulSnapshots()`，用于完整导出。

安全边界：

- 导出包含当前登录用户自己的 personas、Soul versions、snapshots、memories、proposals、nodes、conversations、sessions 和账号邮箱元数据。
- 导出不包含 credential password hash，也不把后台 OpsAudit 暴露给用户前台。
- 删除只基于 authenticated token 的 userId，不接受前端传 userId。
- 用户可见文案只说导出/删除全部数据，不暴露 SoulVersion、SoulSnapshot、scope、evidence 等内部机制。
- 后台 OpsAudit 仍按既有设计作为 admin-only 审计对象保留；用户内容与账号 scoped tables 会随用户删除级联清理。

验证：

```text
npm test -- src/runtime/scoped-runtime-adapter.test.ts --reporter verbose: 5 tests passed
npm run typecheck: passed
npm test: 26 个测试文件、157 tests passed；2 个 integration 文件 skipped
npm run build:demo: passed
git diff --check: passed
本地 /api/me export/delete smoke: passed
```

## 16.2.25 2026-07-06 Step 2.29 scoped runtime HTTP smoke CLI

已完成真实 `/api/me/*` HTTP surface 的 disposable scoped runtime smoke 入口：

- 新增 `src/tools/postgres-scoped-runtime-http-smoke-cli.ts`。
- 新增 `src/tools/postgres-scoped-runtime-http-smoke-cli.test.ts`。
- `package.json` 新增 `runtime:http-smoke` script。
- 命令只允许 `--database-url-env NNZ_POSTGRES_SCOPED_RUNTIME_URL` 与 `--confirm RUN_POSTGRES_SCOPED_RUNTIME_HTTP_SMOKE`。
- 启动真实 `dist-cjs/demo-server.js`，并在 child env 中强制 `NNZ_RUNTIME_PERSISTENCE_MODE=scoped`、设置专用 scoped runtime URL、清空 `DATABASE_URL` / `NNZ_POSTGRES_URL` / `NNZ_DB_PATH` / `NNZ_LLM_*`。
- 先验证 `/healthz` 的 `persistence.mode === "scoped-postgres"`、`runtimeMode === "scoped"`、`scopedPostgresEnv === "NNZ_POSTGRES_SCOPED_RUNTIME_URL"`。
- 再跑 `/api/register`、`/api/me/persona`、`/api/me/chat`、`/api/me/chat-history`、`/api/me/seal`、`/api/me/activate-node`、`/api/me/complete-node`、`/api/me/graduate`、`/api/me/export`、`/api/me/delete`。
- 导出校验包含当前 fixture 自己的 memory/chat，且不包含 `passwordHash` 或 raw password。
- finally 中若 token 仍存在，会尝试通过 `/api/me/delete` 清理 fixture user，然后停止 server。

命令：

```bash
npm run build:demo
npm run runtime:http-smoke -- --database-url-env NNZ_POSTGRES_SCOPED_RUNTIME_URL --confirm RUN_POSTGRES_SCOPED_RUNTIME_HTTP_SMOKE
```

安全边界：

- 拒绝 `DATABASE_URL` / `NNZ_POSTGRES_URL`，并拒绝 `NNZ_POSTGRES_SCOPED_RUNTIME_URL` 与这些生产别名同值。
- stdout 只输出 fixture user count 与固定 check 名称。
- 失败输出只含固定错误类型、HTTP status / error code，不打印 DB URL、token、email、password、memory text、chat content、credential hash、row payload、server log 或 raw error details。
- 该 CLI 是 admin/developer protected smoke，不属于用户前台功能，不引入用户可见机制文案。

验证：

```text
npm test -- src/tools/postgres-scoped-runtime-http-smoke-cli.test.ts --reporter verbose: 8 tests passed
npm run runtime:http-smoke -- --help: passed
npm run typecheck: passed
npm test: 27 个测试文件、165 tests passed；2 个 integration 文件 skipped
npm run build:demo: passed
git diff --check: passed
```

## 16.2.26 2026-07-06 Step 2.30 scoped runtime smoke suite

已完成目标 4 的合并执行入口：

- 新增 `src/tools/postgres-scoped-runtime-smoke-suite-cli.ts`。
- 新增 `src/tools/postgres-scoped-runtime-smoke-suite-cli.test.ts`。
- `package.json` 新增 `runtime:smoke-suite` script。
- 命令只允许 `--database-url-env NNZ_POSTGRES_SCOPED_RUNTIME_URL` 与 `--confirm RUN_POSTGRES_SCOPED_RUNTIME_SMOKE_SUITE`。
- suite 会串行运行 direct `runtime:smoke`、`npm run build:demo`、HTTP `runtime:http-smoke`。
- `--skip-build` 只用于 demo server build output 已确认是当前版本的情况。
- direct 与 HTTP 子命令仍各自使用自己的 confirm string，由 suite 内部安全转发。

命令：

```bash
npm run runtime:smoke-suite -- --database-url-env NNZ_POSTGRES_SCOPED_RUNTIME_URL --confirm RUN_POSTGRES_SCOPED_RUNTIME_SMOKE_SUITE
```

安全边界：

- 拒绝 `DATABASE_URL` / `NNZ_POSTGRES_URL`，并拒绝 `NNZ_POSTGRES_SCOPED_RUNTIME_URL` 与这些生产别名同值。
- suite stdout 只输出固定 stage：directRuntimeAdapterSmoke、demoBuild、httpApiSmoke。
- 任一 stage 失败时，只输出固定 stage 失败文案。
- 不拼接子命令 stdout/stderr，避免 raw DB error、server log、child process output 或 secret 被带出。
- 不打印 DB URL、token、email、password、memory text、chat content、credential hash、row payload 或 raw error details。
- 该 CLI 是 admin/developer protected smoke，不属于用户前台功能，不引入用户可见机制文案。

验证：

```text
npm test -- src/tools/postgres-scoped-runtime-smoke-suite-cli.test.ts --reporter verbose: 10 tests passed
npm run runtime:smoke-suite -- --help: passed
npm run typecheck: passed
npm test: 28 个测试文件、175 tests passed；2 个 integration 文件 skipped
npm run build:demo: passed
git diff --check: passed
```

## 16.2.27 2026-07-06 Step 2.31 migration validation suite

已完成目标 1+2 的合并执行入口：

- 新增 `src/tools/postgres-scoped-migration-validation-suite-cli.ts`。
- 新增 `src/tools/postgres-scoped-migration-validation-suite-cli.test.ts`。
- `package.json` 新增 `migration:validation-suite` script。
- 命令支持 `--from-json` 或 `--from-sqlite`，并复用 readiness 的 `--snapshot-out` / `--report-out` / `--summary-out`。
- 命令只允许 `--database-url-env NNZ_POSTGRES_INTEGRATION_URL` 与 `--confirm RUN_POSTGRES_SCOPED_MIGRATION_VALIDATION_SUITE`。
- suite 会先运行 offline `migration:readiness`；只有 readiness exit 0 时才运行 disposable `migration:smoke`。
- `--force` 会转发给 readiness，用于明确覆盖本地输出文件。
- migration smoke 子命令仍使用自己的 confirm string，由 suite 内部安全转发。

命令：

```bash
npm run migration:validation-suite -- --from-json <snapshot-or-wrapper-json-path> --snapshot-out <raw-snapshot-json-path> --report-out <sanitized-report-json-path> --summary-out <sanitized-summary-json-path> --database-url-env NNZ_POSTGRES_INTEGRATION_URL --confirm RUN_POSTGRES_SCOPED_MIGRATION_VALIDATION_SUITE
npm run migration:validation-suite -- --from-sqlite <sqlite-db-path> --snapshot-out <raw-snapshot-json-path> --report-out <sanitized-report-json-path> --summary-out <sanitized-summary-json-path> --database-url-env NNZ_POSTGRES_INTEGRATION_URL --confirm RUN_POSTGRES_SCOPED_MIGRATION_VALIDATION_SUITE
```

安全边界：

- 拒绝 `DATABASE_URL` / `NNZ_POSTGRES_URL`，并拒绝 `NNZ_POSTGRES_INTEGRATION_URL` 与这些生产别名同值。
- readiness 失败或返回 blocking errors 时不会运行 DB smoke。
- suite stdout 只输出固定 stage 与输出路径：offlineMigrationReadiness、disposablePostgresMigrationSmoke、raw snapshot、sanitized report、sanitized summary。
- 任一 stage 失败时，只输出固定 stage 失败文案。
- 不拼接 readiness/smoke 子命令 stdout/stderr，避免 raw snapshot、raw DB error、child command output 或 secret 被带出。
- 不打印 DB URL、memory text、chat content、credential hash、raw snapshot data、row payload 或 raw error details。
- 该 CLI 是 admin/developer protected validation，不属于用户前台功能，不引入用户可见机制文案。

验证：

```text
npm test -- src/tools/postgres-scoped-migration-validation-suite-cli.test.ts --reporter verbose: 8 tests passed
npm run migration:validation-suite -- --help: passed
npm run typecheck: passed
npm test: 29 个测试文件、183 tests passed；2 个 integration 文件 skipped
npm run build:demo: passed
git diff --check: passed
```

## 16.2.28 2026-07-06 Step 2.32 Soul Ops role token smoke CLI

已完成目标 3 的本地受保护验证入口：

- 新增 `src/tools/ops-role-token-smoke-cli.ts`。
- 新增 `src/tools/ops-role-token-smoke-cli.test.ts`。
- `package.json` 新增 `ops:role-smoke` script。
- 默认读取本地 shell 中的 `NNZ_OPS_VIEWER_TOKEN` / `NNZ_OPS_OPERATOR_TOKEN` / `NNZ_OPS_ADMIN_TOKEN`，也可用 `--viewer-token-env` / `--operator-token-env` / `--admin-token-env` 改 env key。
- 命令必须传 `--base-url <https://...>` 与 `--confirm RUN_OPS_ROLE_TOKEN_SMOKE`。
- 默认非破坏性：验证 missing token 401、invalid token 403、viewer overview/audit read、viewer cleanup dry-run 被拒绝、operator overview/dry-run、operator delete 被拒绝、admin overview/dry-run，以及 admin delete 缺确认码被拒绝。
- 可选 confirmed cleanup check 必须同时传 `--include-delete --delete-confirm RUN_OPS_ROLE_TOKEN_DELETE_SMOKE`；实际 API body 仍使用服务端要求的 `confirm:"DELETE_TEST_USERS"`。

命令：

```bash
npm run ops:role-smoke -- --base-url https://nnz-kego.onrender.com --confirm RUN_OPS_ROLE_TOKEN_SMOKE
npm run ops:role-smoke -- --base-url https://nnz-kego.onrender.com --include-delete --delete-confirm RUN_OPS_ROLE_TOKEN_DELETE_SMOKE --confirm RUN_OPS_ROLE_TOKEN_SMOKE
```

安全边界：

- stdout 只输出 baseUrl、deleteMode、token env 名称和固定 check 名称。
- stderr 只输出固定失败文案，可附带 httpStatus/errorCode，不输出 raw response、server log 或 network detail。
- 不打印 token 值、response payload、用户内容、cleanup receipt、数据库 URL、credential hash、memory/chat 正文。
- 默认不会执行 confirmed deletion；要跑 confirmed cleanup smoke 必须有第二道显式确认。
- 该 CLI 是 admin/developer protected verification，不属于用户前台功能，不引入用户可见机制文案。

验证：

```text
npm test -- src/tools/ops-role-token-smoke-cli.test.ts --reporter verbose: 7 tests passed
npm run ops:role-smoke -- --help: passed
npm run typecheck: passed
npm test: 30 个测试文件、190 tests passed；2 个 integration 文件 skipped
npm run build:demo: passed
git diff --check: passed
```

## 16.2.29 2026-07-07 Step 2.33 release preflight CLI

已完成三类外部实跑前的本地红acted 检查入口：

- 新增 `src/tools/release-preflight-cli.ts`。
- 新增 `src/tools/release-preflight-cli.test.ts`。
- `package.json` 新增 `release:preflight` script。
- 默认检查 `NNZ_MIGRATION_SNAPSHOT_PATH` 或 `--snapshot` 指向的本地输入是否存在。
- 默认检查 `NNZ_POSTGRES_INTEGRATION_URL`、`NNZ_POSTGRES_SCOPED_RUNTIME_URL` 是否设置，且不等于 `DATABASE_URL` / `NNZ_POSTGRES_URL`。
- 默认检查 `NNZ_OPS_VIEWER_TOKEN` / `NNZ_OPS_OPERATOR_TOKEN` / `NNZ_OPS_ADMIN_TOKEN` 是否设置。
- 支持覆盖 snapshot/env/token key 和 Ops base URL。

命令：

```bash
npm run release:preflight -- --snapshot <sqlite-or-snapshot-json-path>
npm run release:preflight -- --snapshot-env NNZ_MIGRATION_SNAPSHOT_PATH
```

安全边界：

- 不读取 snapshot 内容，只检查文件存在性。
- 不连接数据库、不发送 HTTP/network 请求。
- stdout 只输出 ready/blocked、env key 名称和固定命令模板。
- 不打印 snapshot 路径、数据库 URL、token 值、用户内容、cleanup receipt、server log 或 raw network details。
- 该 CLI 不能替代真实 `migration:validation-suite`、`ops:role-smoke` 或 `runtime:smoke-suite`，只是让外部输入缺口可见。

验证：

```text
npm test -- src/tools/release-preflight-cli.test.ts --reporter verbose: 6 tests passed
npm run release:preflight -- --help: passed
npm run release:preflight: 当前环境 blocked，按预期未触网/未连库
npm run typecheck: passed
npm test: 31 个测试文件、196 tests passed；2 个 integration 文件 skipped
npm run build:demo: passed
git diff --check: passed
```

## 16.2.30 2026-07-07 Step 2.34 release validation suite CLI

已完成剩余外部验证的一键总编排入口：

- 新增 `src/tools/release-validation-suite-cli.ts`。
- 新增 `src/tools/release-validation-suite-cli.test.ts`。
- `package.json` 新增 `release:validation-suite` script。
- 命令要求 `--confirm RUN_NNZ_RELEASE_VALIDATION_SUITE`，没确认时不跑任何 stage。
- stage 顺序固定：`release:preflight` -> `migration:validation-suite` -> 默认非破坏性 `ops:role-smoke` -> `runtime:smoke-suite`。
- `ops:role-smoke` stage 不传 `--include-delete`，因此不会执行 confirmed cleanup deletion。
- `--force` 只转发给 migration validation suite，用于覆盖本地 readiness 输出。
- `--host` / `--port` / `--server-entry` / `--timeout-ms` / `--skip-build` 转发给 runtime smoke suite。

命令：

```bash
npm run release:validation-suite -- --from-json <snapshot-or-wrapper-json-path> --snapshot-out <raw-snapshot-json-path> --report-out <sanitized-report-json-path> --summary-out <sanitized-summary-json-path> --confirm RUN_NNZ_RELEASE_VALIDATION_SUITE
npm run release:validation-suite -- --from-sqlite <sqlite-db-path> --snapshot-out <raw-snapshot-json-path> --report-out <sanitized-report-json-path> --summary-out <sanitized-summary-json-path> --confirm RUN_NNZ_RELEASE_VALIDATION_SUITE
```

安全边界：

- 不使用 `DATABASE_URL` / `NNZ_POSTGRES_URL` 做 disposable validation；底层 stage 仍强制使用专用 env。
- 失败时只打印固定 stage 名称，不拼接子命令 stdout/stderr。
- 不打印数据库 URL、token 值、snapshot 内容、用户内容、cleanup receipt、child command output、server log 或 raw error details。
- 默认不跑 confirmed Ops cleanup deletion。
- 该 CLI 是 admin/developer release validation，不属于用户前台功能，不引入用户可见机制文案。

验证：

```text
npm test -- src/tools/release-validation-suite-cli.test.ts --reporter verbose: 8 tests passed
npm run release:validation-suite -- --help: passed
npm run release:validation-suite -- --from-json missing-snapshot.json --snapshot-out raw.json --report-out report.json --summary-out summary.json --confirm RUN_NNZ_RELEASE_VALIDATION_SUITE: failed during release preflight as expected, no DB/network stage
npm run typecheck: passed
npm test: 32 个测试文件、204 tests passed；2 个 integration 文件 skipped
npm run build:demo: passed
git diff --check: passed
```

## 16.2.31 2026-07-07 Step 2.35 release evidence option

本地已为 release validation suite 增加脱敏上线证据产物：

- `release:validation-suite` 新增可选 `--evidence-out <sanitized-evidence-json-path>`。
- 只有传入 `--confirm RUN_NNZ_RELEASE_VALIDATION_SUITE` 后才会尝试写 evidence；缺确认或参数错误时不写。
- suite 全部通过时写 `status: "passed"`，四个 stage 均为 `passed`。
- 确认执行后若某个 stage 失败，写 `status: "failed"`、`failedStage`，已跑 stage 标记为 `passed/failed`，后续 stage 标记为 `not_run`。
- evidence 只记录 stage 状态、env key 名、本地产物类别和 redaction 说明；不记录 snapshot input/output path、DB URL、token 值、用户内容、cleanup receipt、child command output、server log 或 raw error detail。
- stdout/stderr 也不打印 evidence output path；写 evidence 失败时只返回固定脱敏错误。

命令：

```bash
npm run release:validation-suite -- --from-json <snapshot-or-wrapper-json-path> --snapshot-out <raw-snapshot-json-path> --report-out <sanitized-report-json-path> --summary-out <sanitized-summary-json-path> --evidence-out <sanitized-evidence-json-path> --confirm RUN_NNZ_RELEASE_VALIDATION_SUITE
npm run release:validation-suite -- --from-sqlite <sqlite-db-path> --snapshot-out <raw-snapshot-json-path> --report-out <sanitized-report-json-path> --summary-out <sanitized-summary-json-path> --evidence-out <sanitized-evidence-json-path> --confirm RUN_NNZ_RELEASE_VALIDATION_SUITE
```

当前已验证：

```text
npm test -- src/tools/release-validation-suite-cli.test.ts --reporter verbose: 10 tests passed
npm run typecheck: passed
npm run release:validation-suite -- --help: passed
npm run release:validation-suite -- --from-json missing-snapshot.json --snapshot-out raw.json --report-out report.json --summary-out summary.json --evidence-out /private/tmp/nnz-release-evidence-smoke.json --confirm RUN_NNZ_RELEASE_VALIDATION_SUITE: failed during release preflight as expected, no DB/network stage, evidence JSON sanitized
npm test: 32 个测试文件、206 tests passed；2 个 integration 文件 skipped
npm run build:demo: passed
git diff --check: passed
```

## 16.3 2026-06-22 H5 modal / CTA 修复

接手前，另一位 AI 在 2026-06-18 到 2026-06-21 主要围绕 `public/index.html` 反复修 H5 modal / CTA，最后 `main` 回退到：

```text
560520f fix: revert index.html to stable version before modal
```

回退后线上可用但不是 modal：CTA 只滚动到内嵌 `#demo` H5。

本次已在完整工作区修复：

- CTA 改为 `openExperience(event)`。
- 原唯一 `#demo` H5 DOM 改为 modal overlay，没有复制 H5 节点，避免重复 id 和事件错绑。
- 新增 `closeExperience()`、Escape 关闭、遮罩关闭、body 滚动锁定、焦点恢复。
- 修复 `h5RenderConversation()` 三元表达式被 `h5RefreshCovenantState()` 打断的问题。
- 补齐 `h5AuthHeaders()`。
- `h5CovenantAction()` 成功后改为调用已存在的 `h5LoadConversation()`。

验证：

```text
npm ci: 通过，0 vulnerabilities
better-sqlite3: Mach-O 64-bit bundle arm64
npm run typecheck: 通过
npm test: 12 个测试文件、79 tests passed
npm run build:demo: 通过
local /healthz: 通过
modal JS smoke: modal-smoke-ok
```

记录见：

```text
../nnz-mvp-2026-06-22-H5体验弹窗与CTA修复记录.md
```

上线状态：本次修复已通过提交 `5e0df09 fix: restore h5 experience modal` 推送到 GitHub `main`；GitHub Actions run `28012032867` success；Render 首页已返回 H5 modal / CTA / checkbox 多选版本。记录见 `../nnz-mvp-2026-06-23-H5修复上线验收记录.md`。

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
