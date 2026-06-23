# nnz-mvp 当前状态与交接指南

> 更新：2026-06-23
> 覆盖：Soul 作用域、Covenant 状态机、Memory 分层、Soul Ops、安全护栏、Render demo、LLM 对话、自动化提取管线、SQLite 持久化、登录注册、官网首页

## 2026-06-22 GitHub / CI / 本地状态

GitHub 仓库已经建立：

```text
https://github.com/chaoshorizon316/nnz
```

当前已知状态：

```text
本次工作开始时远端 main: 1ee270b docs: record soul ops push status
2026-06-11 新增: Render Postgres 已配置并通过重启持久化 smoke
2026-06-11 Step 1: 后台测试数据清理 + 独立 /ops Soul Ops 后台雏形已实现、验证并推送
2026-06-16 新增: Render 已配置 NNZ_OPS_TOKEN，云端 /ops 和 cleanup dry-run smoke 通过
2026-06-16 Step 2.1: Soul Ops 审计日志已实现，下一步进入 RBAC / 删除回执
2026-06-17 Step 2.2: Soul Ops RBAC + 删除回执已实现，下一步进入审计查询与云端角色化配置
2026-06-17 Step 2.3: Soul Ops Audit 查询接口 + /ops Audit tab 已实现，下一步进入云端角色 token smoke 与 scoped repository
2026-06-17 Step 2.3 push 后云端验收: GitHub Actions success，Render /ops Audit tab 与 audit-events 401/403 通过
2026-06-18 Step 2.4: ScopedSoulRepository 作用域绑定仓储适配层已实现，本地 typecheck / domain scope tests / build 通过
2026-06-18~21 H5 首页/弹窗方向多轮尝试，最终 main 回退到 modal 前稳定版
2026-06-22 线上与工作区核查：Render healthz/Postgres 正常，Ops audit 无 token 401 正常；当前 Codex 默认 workspace 是空壳副本，完整副本在 `黑曜石知识库 2/Personal/我还在`
2026-06-22 H5 修复：`public/index.html` 已把 CTA 改回打开 H5 体验 modal，并修复 h5RenderConversation / h5AuthHeaders / h5LoadChatHistory 遗留断点；本地 npm ci、typecheck、12 个测试文件 79 tests、build:demo 通过
2026-06-23 H5 创建体验优化：`public/index.html` 已把 Step 2 Page 1 改为输入区 + 常用称呼左右结构，常用称呼选中态更明显；特征选择改为复选框式真多选，并保持后端 traits 字符串 payload 兼容；本地 typecheck、12 个测试文件 79 tests、build:demo 通过
```

当前本地相对远端：

```text
main...origin/main
```

最新提交：

```text
560520f fix: revert index.html to stable version before modal
```

最新云端 Soul Ops 记录：

```text
nnz-mvp-2026-06-16-SoulOps云端启用记录.md
nnz-mvp-2026-06-16-Step2.1-SoulOps审计日志.md
nnz-mvp-2026-06-17-Step2.2-SoulOps-RBAC与删除回执.md
nnz-mvp-2026-06-17-Step2.3-SoulOps-Audit查询与角色云端验证.md
nnz-mvp-2026-06-17-Step2.3-推送后云端验收记录.md
nnz-mvp-2026-06-18-Step2.4-ScopedSoulRepository作用域仓储.md
nnz-mvp-2026-06-22-线上与工作区核查记录.md
nnz-mvp-2026-06-22-H5体验弹窗与CTA修复记录.md
nnz-mvp-2026-06-23-H5创建体验选项交互优化.md
```

## 2026-06-22 工作区注意

当前 Codex 环境默认给出的路径：

```text
/Users/will/Library/Mobile Documents/iCloud~md~obsidian/Documents/黑曜石知识库/Personal/我还在
```

核查时发现这是异常空壳副本：`.git` 不完整，`nnz-mvp` 基本只剩 `node_modules`。

当前完整副本是：

```text
/Users/will/Library/Mobile Documents/iCloud~md~obsidian/Documents/黑曜石知识库 2/Personal/我还在
```

这份副本 `git status -sb` 为：

```text
## main...origin/main
```

后续修改代码、记录日志、运行验证前，应先确认工作目录指向完整副本，避免在空壳目录误操作。

6 月 8 日引入 SQLite / 登录注册 / 官网首页后，远端 GitHub Actions 出现 failure。6 月 9 日已修复；6 月 10 日首页 H5 和 Postgres snapshot persistence 已推送：

- `serialize()` / `deserialize()` 的 credential 类型与 `exactOptionalPropertyTypes` 问题。
- `deleteUserScopedData()` 误删所有 credentials 的作用域 bug。
- 注册时 credential userId 与实际 user id 不一致的问题。
- 注册后未持久化的问题。
- 新增 credential 删除隔离测试与 credential 持久化 userId 保持测试。

CI 内容：

```bash
cd nnz-mvp
npm ci
npm run typecheck
npm test
npm run build:demo
npm audit
```

2026-06-09 验证通过：

```text
GitHub Actions: success
Render smoke: /healthz, /, /demo, /api/register, /api/login, /api/chat
8 test files passed
61 tests passed
typecheck passed
build:demo passed
npm audit: 0 vulnerabilities
```

详细记录：`nnz-mvp-2026-06-09-工作记录.md`

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
├── auth/
│   └── auth.ts          — bcrypt + JWT + Bearer token helper
├── domain/
│   ├── types.ts          — 全部类型定义（User, Soul, Memory, Session, Maturity…）
│   ├── errors.ts         — ScopeValidationError, NotFoundError, OwnershipError, CovenantStateError
│   ├── soul-store.ts     — InMemorySoulStore：作用域隔离 + covenant 状态机 + memory 分层 + maturity
│   ├── scoped-soul-repository.ts — 绑定 userId + personaId 的作用域仓储适配层
│   ├── persistence.ts    — SQLite save/load for demo persistence
│   ├── soul-scope.test.ts
│   ├── scoped-soul-repository.test.ts
│   ├── persistence.test.ts
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
| `scoped-soul-repository.ts` | ~150 行 | 作用域绑定适配层 | bindSoulRepository, ScopedSoulRepository |
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

**67 条测试通过**（2026-06-11 `/tmp` 干净环境 typecheck/test/build 验证）：

- `auth/auth.test.ts`
- `domain/soul-scope.test.ts`
- `domain/persistence.test.ts`
- `domain/postgres-persistence.test.ts`
- `extraction/orchestrator.test.ts`
- `llm/adapter.test.ts`
- `ops/ops-console.test.ts`
- `runtime/soul-runtime.test.ts`
- `runtime/llm-reply.test.ts`
- `runtime/soul-guard.test.ts`

## 下一步：推荐推进顺序

### 已完成：首页 H5 真实用户私有 Soul 验证入口

2026-06-10 已把验证流程切到 `index` 首页：

- 首页 `/` 的“在线体验”不再嵌入 `/demo`。
- 用户可以在首页注册/登录、创建记忆中的人、发送第一句话。
- 新增 `/api/me/*` 用户端接口，统一从 JWT 取 auth user，不接受前端传 `userId`。
- `/demo` 保留为开发者 A/B 双用户验证页。
- 干净副本验证通过：64 tests passed，typecheck/build/audit 通过。
- 本地 API/browser smoke 通过：未登录 401，跨用户 persona 访问 403，首页不露“双人演示”开发入口。

详细记录：`nnz-mvp-2026-06-10-工作记录.md`

### 已完成：推送并做云端 H5 smoke

2026-06-10 已推送到 `99c38cb feat: add postgres snapshot persistence`。GitHub Actions 和 Render smoke 均已通过：

```text
GitHub Actions: success
Run: https://github.com/chaoshorizon316/nnz/actions/runs/27267872384
Render /healthz: 200 ok，当时 fixture: "in-memory"（2026-06-11 已切到 "postgres"）
首页 /: 新 H5 真实用户流，未回退到旧 iframe
/demo: 仍是开发者 A/B 验证页；Soul Ops 已拆到受保护的 /ops
/api/me 未登录: 401
跨用户 persona chat-history: 403
A/B 同名“爸爸”: 回复不同，无机制词泄露
```

### 已完成：接 Postgres / Render managed database

2026-06-11 云端 demo 已从 `fixture: in-memory` 切到 `fixture: postgres`。Render Web Service `nnz` 已配置 `DATABASE_URL`，并通过重新部署和重启持久化 smoke：

- 新增 `src/domain/postgres-persistence.ts`。
- 支持 `DATABASE_URL` 或 `NNZ_POSTGRES_URL`。
- Postgres 优先级高于 `NNZ_DB_PATH`。
- `/healthz` 会显示 `fixture: "postgres"` / `"sqlite"` / `"in-memory"`。
- 2026-06-11 已增强 `/healthz.persistence`，可看到 `postgresConfigured`、`postgresEnv`、`sqliteConfigured`，但不会返回 secret value。
- 新增 Postgres snapshot persistence 测试，验证 A/B 同名 persona、conversation、credential 恢复后仍隔离。

2026-06-11 Render 状态：

```text
Web Service: nnz
Service ID: srv-d8go7pmq1p3s739r12jg
URL: https://nnz-kego.onrender.com
Database: nnz-mvp-postgres
Database Service ID: dpg-d8l271hkh4rs73fmdtn0-a
Region: Ohio
Plan: Free
Expiration: 2026-07-11
Runtime persistence env: DATABASE_URL
```

当前 `/healthz`：

```text
fixture = "postgres"
persistence.mode = "postgres"
persistence.postgresConfigured = true
persistence.postgresEnv = "DATABASE_URL"
```

云端 smoke：

```text
注册测试用户 -> 创建“爸爸” -> 发送一句话 -> chat-history 2 条
Manual Deploy -> Restart service
重新登录同一测试用户 -> persona 和 chat-history 均可读回
persistedAfterRestart = true
```

注意：Render 编辑态中 LLM secret 值显示为空是平台保护值，不代表已清空；部署日志已确认 `LLM adapter initialized for extraction pipeline.`。

下一步建议：

1. 后续再把 snapshot persistence 演进为逐表 repository，不要绕开 `userId + personaId`。
2. 增加后台测试数据清理能力，避免 smoke 用户长期堆积。
3. 如果要把 `DATABASE_URL` 从 External URL 切回 Render Internal URL，必须重新做 `/healthz` 和重启后数据恢复 smoke。

### 再次：后台拆分

2026-06-11 Step 1 已完成第一版后台拆分：

- 新增 `src/ops/ops-console.ts` 和 `src/ops/ops-console.test.ts`。
- 新增独立 `/ops` 后台页面。
- 新增受 `NNZ_OPS_TOKEN` 保护的 `GET /api/ops/overview`。
- 新增受 `NNZ_OPS_TOKEN` 保护的 `POST /api/ops/cleanup-test-users`。
- 清理接口默认 dry-run；真删除必须传 `confirm:"DELETE_TEST_USERS"`。
- 仅匹配明确 smoke/test 账号，例如 `@example.test`、`codex-postgres-smoke-*`、`codex-ops-smoke-*`、`nnz-smoke-*`。
- 删除复用 `deleteUserScopedData(userId)`，不会跨用户删除。

2026-06-16 已完成云端启用：

- Render Web Service `nnz` 已配置 `NNZ_OPS_TOKEN` 并重新部署。
- `/ops` 页面返回 200。
- `/api/ops/overview` 缺 token 返回 401，错 token 返回 403，带 token 返回 200。
- `/api/ops/cleanup-test-users` dry-run 返回 1 个明确 smoke/test 用户候选，`deletedUserIds` 为 0。
- token 明文只保存在 Render 环境变量中，不记录到仓库。

2026-06-16 Step 2.1 已完成 Soul Ops 审计日志：

- 新增 `OpsAuditEvent`。
- `recordOpsAuditEvent()` / `listOpsAuditEvents()` 已进入 `InMemorySoulStore`。
- `/api/ops/overview`、`/api/ops/cleanup-test-users`、401/403 授权拒绝都会写 audit。
- `opsAuditEvents` 纳入 Postgres snapshot；SQLite 新增 `ops_audit_events` 表。
- `/ops` 页面新增 `Audit Events` 指标和“最近后台操作”面板。
- `npm audit` 新增的 `esbuild <0.28.1` 公告已通过 package overrides 修复。

2026-06-17 Step 2.2 已完成 Soul Ops RBAC 与删除回执：

- 新增 `src/ops/ops-auth.ts` 和 `src/ops/ops-auth.test.ts`。
- 旧 `NNZ_OPS_TOKEN` 继续作为 admin，保持 Render 兼容。
- 新增可选 `NNZ_OPS_VIEWER_TOKEN`、`NNZ_OPS_OPERATOR_TOKEN`、`NNZ_OPS_ADMIN_TOKEN`。
- viewer 只能读 overview；operator 可 dry-run；admin 可真删除。
- cleanup 真删除返回 `receipts` 删除回执。
- `/ops` 页面显示当前角色、actor、权限，并按权限禁用危险按钮。
- `tsconfig.demo.json` 已包含 `src/ops/**/*.ts`，避免 Render build 找不到 `ops-auth`。

2026-06-17 Step 2.3 已完成 Soul Ops Audit 查询：

- 新增 `GET /api/ops/audit-events`。
- 新增 `AUDIT_QUERY` 审计动作，查询审计本身也会被记录。
- `queryOpsAuditEvents()` 支持按 action / actor / targetUserId 过滤，支持 limit / offset 分页。
- `/ops` 页面拆成 `Dashboard` / `Audit` tab。
- Audit tab 支持 action 下拉、actor 输入、target userId 输入、limit 选择和上一页/下一页。
- 本地 API smoke 已确认 admin/viewer 都能查询 audit；viewer 仍不能执行 cleanup 删除。

本地验证：

```text
/tmp/nnz-step23-verify.iLBxJh
npm ci
npm test         # 11 files, 73 tests passed
npm run typecheck
npm run build:demo
```

本地 API smoke：`/ops` 返回 200；`/api/ops/audit-events?action=AUDIT_QUERY&actor=ops:admin&limit=2&offset=0` 返回 200；viewer token 查询 audit 返回 200 且 `canDeleteCleanup=false`。

云端基础 smoke：GitHub Actions run `27677337466` success；Render `/healthz` 返回 `fixture:"postgres"`；`/ops` 页面包含 Audit tab；`/api/ops/audit-events` 无 token 返回 401，错 token 返回 403。

下一步：进入 Step 2.4。优先在 Render 验证可选角色 token（viewer/operator/admin）的云端权限边界，然后开始把 Postgres snapshot persistence 演进为强作用域 repository。token 明文不得写入仓库或文档。

### 后续：微信 / H5 用户端雏形

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

---

## 2026-06-08 更新：SQLite 持久化 + 登录注册 + 官网首页上线

> 2026-06-09 纠偏：6 月 8 日功能方向成立，但当时的代码在 typecheck/build 和 credential 作用域上有问题。以 6 月 9 日工作记录和当前代码为准。

### SQLite 持久化

`src/domain/persistence.ts` — saveStore/loadStore，`InMemorySoulStore` 加 serialize/deserialize。2026-06-09 修复后为 61 条测试全绿。`.env` 加 `NNZ_DB_PATH` 启用。

### 登录/注册

`src/auth/auth.ts` — bcrypt + JWT。`POST /api/register` + `POST /api/login`。前端登录表单已接入。

### 官网首页

`index.html` 搬到 `nnz-mvp/public/`，Render 直接服务。访问 `nnz-kego.onrender.com` 即见完整品牌落地页。/demo 保留 Chat Demo。

### 详细记录

见 `nnz-mvp-2026-06-08-工作记录.md`

---

## 2026-06-09 更新：CI 修复 + Credential 作用域收口

修复重点：

- `InMemorySoulStore.serialize()` 返回类型补齐 `credentials`。
- `deserialize()` 不再显式写入 undefined optional 字段，兼容 `exactOptionalPropertyTypes`。
- `deleteUserScopedData(userA.id)` 只删除用户 A 的 credential，不影响用户 B。
- `storeCredential()` 必须绑定已存在用户。
- `POST /api/register` 使用 `store.createUser(email)` 返回的真实 `user.id` 签 JWT 和保存 credential。
- 注册成功后调用 `persistIfEnabled()`。

验证：

```text
/tmp clean copy
npm ci
npm run typecheck
npm test         # 61 passed
npm run build:demo
npm audit        # 0 vulnerabilities
```

当前修复已推送并通过 GitHub Actions / Render smoke。2026-06-10 已实现并云端验证首页 H5 真实用户私有 Soul 验证入口；2026-06-11 已完成 Render Postgres 接入和重启后持久化 smoke；同日 Step 1 已完成后台测试数据清理和独立 `/ops` Soul Ops 后台雏形。2026-06-16 已完成 Render `NNZ_OPS_TOKEN` 配置和云端 `/ops` smoke，并完成 Step 2.1 Soul Ops 审计日志。2026-06-17 已完成 Step 2.2 Soul Ops RBAC 与删除回执；同日 Step 2.3 已完成 Audit 查询接口和 `/ops` Audit tab，并已推送通过 GitHub Actions / Render 基础 smoke。下一步进入云端角色 token smoke / scoped repository。
