# Claude Code Entry: 念念在


## Render 云端 Demo（2026-06-04）

```text
https://nnz-kego.onrender.com
```

免费版无请求 15 分钟会休眠，首次访问需等 30–60 秒唤醒。部署细节见 `nnz-mvp-2026-06-04-云托管完成交接.md`。

## 最新 GitHub / CI / 本地状态（2026-06-11）

GitHub 仓库：

```text
https://github.com/chaoshorizon316/nnz
```

当前时间线：

```text
远端 main: 9f67ef9 docs: record render postgres resource
2026-06-11 新增: Render Postgres 已配置并通过重启持久化 smoke
2026-06-11 Step 1: 后台测试数据清理 + 独立 /ops Soul Ops 后台雏形已本地实现并验证
```

说明：

- 6 月 8 日的 SQLite / 登录注册 / 官网首页变更曾让 GitHub Actions 失败。
- 6 月 9 日已修复 typecheck/build、credential 持久化和 credential 删除作用域问题。
- `99c38cb` 已推送到 GitHub，`NNZ MVP CI` success。
- 6 月 10 日本地已把真实验证流程切到首页 H5：注册/登录 -> 创建记忆中的人 -> 私密聊天；新增 `/api/me/*`，用户端不接受前端传 `userId`。
- 6 月 10 日 `/tmp` 干净副本验证：9 个测试文件、64 条测试全绿，typecheck / build / audit 通过；本地 API/browser smoke 通过。
- 6 月 10 日 Render 云端 smoke 通过：首页 `/` 已是 H5 真实用户流，`/demo` 仍是开发者验证页，`/api/me` 未登录 401，跨用户 persona 访问 403，A/B 同名“爸爸”回复不同且无机制词泄露。
- Postgres snapshot persistence 已合入并通过 CI；6 月 11 日已在 Render Web Service `nnz` 配置 `DATABASE_URL` 并重新部署。
- 当前 `/healthz`：`fixture: "postgres"`，`persistence.mode: "postgres"`，`persistence.postgresConfigured: true`，`persistence.postgresEnv: "DATABASE_URL"`。
- 6 月 11 日云端持久化 smoke：注册临时测试用户 -> 创建“爸爸” -> 发送一句话 -> Restart service -> 重新登录后 persona 与 2 条 chat-history 均可读回。
- Render runtime logs 已确认：`Postgres persistence configured via DATABASE_URL.` 与 `LLM adapter initialized for extraction pipeline.`。
- 6 月 11 日 Step 1 已实现：新增 `src/ops/ops-console.ts` / `src/ops/ops-console.test.ts`，拆出独立 `/ops` 后台，新增受 `NNZ_OPS_TOKEN` 保护的 `/api/ops/overview` 和 `/api/ops/cleanup-test-users`。
- `/api/ops/cleanup-test-users` 默认 dry-run；真删除必须传 `dryRun:false` 和 `confirm:"DELETE_TEST_USERS"`；只匹配明确 smoke/test 账号并调用 `deleteUserScopedData(userId)`，不会删除 A/B demo 或普通用户。
- 本地干净副本验证：`/tmp/nnz-step1-final.MF0YVg` 中 `npm ci`、`npm run typecheck`、`npm test`、`npm run build:demo`、`npm audit` 全部通过，10 个测试文件、67 条测试全绿，0 vulnerabilities。
- 本地 `/ops` browser smoke 通过：输入 `dev-ops-token` 后显示 8 个核心指标、用户表、2 个 Persona 成熟度卡片和测试数据清理面板。

CI 会在 `nnz-mvp` 中执行：

```bash
npm ci
npm run typecheck
npm test
npm run build:demo
npm audit
```

最新通过记录见 GitHub Actions：

```text
https://github.com/chaoshorizon316/nnz/actions
```

本地可靠验证方式仍建议使用 `/tmp` 干净副本：

```bash
tmpdir=$(mktemp -d /tmp/nnz-fix-verify.XXXXXX)
git archive --format=tar HEAD | tar -x -C "$tmpdir"
git diff --binary > "$tmpdir/worktree.patch"
cd "$tmpdir"
git apply worktree.patch
cd nnz-mvp
npm ci
npm run typecheck
npm test
npm run build:demo
npm audit
```

2026-06-11 结果：`/tmp/nnz-step1-final.MF0YVg` 干净副本中 10 个测试文件、67 条测试全绿，typecheck / build / audit 通过；首页 H5 桌面/移动浏览器 smoke 通过；API smoke 覆盖 401、403、A/B 同名 persona 隔离；GitHub Actions success；Render H5/Postgres smoke 通过；本地 `/ops` 和清理 API smoke 通过。

最新 CI run：

```text
https://github.com/chaoshorizon316/nnz/actions/runs/27267872384
```

## 2026-06-05 接手校验

当前本地与远端同步：`main...origin/main`。

已完成：

- DeepSeek / OpenAI-compatible LLM adapter。
- LLM 对话生成 `generateLlmReply()`。
- 自动化提取管线 `src/extraction/`。
- A/B prompt 分化：不同关系、口头禅、对话历史进入 prompt。
- Step 5.1 本地已抽出 `src/runtime/llm-reply.ts`，新增 prompt contract / fallback 测试，测试数增至 52。
- Render demo 可访问：`https://nnz-kego.onrender.com`。

2026-06-05 实测云端 `/api/chat`：A/B 回复已不完全相同。A 使用“丫头 / 你自己拿主意”，B 使用“儿子 / 慢慢来”。后续仍可增强差异度，但不是从零修复。

2026-06-05 用户配置 Render LLM 环境变量后复测：云端短会话确认走 LLM 路径，连续多轮对话触发 extraction，A 生成 `CHAT_EXCERPT` 与 proposal，B 未被污染。

2026-06-05 推送 `ef2b364` 后复测：GitHub CI success，Render `/healthz` 正常；云端 `/api/chat` A/B 回复非空、不相等、无机制词、不是确定性 fallback 固定句式；连续多轮对话触发 extraction，A 生成 9 条 `CHAT_EXCERPT` 与 2 条 proposal，B 无 `CHAT_EXCERPT`、无 proposal、无 A 的婚礼节点记忆。

注意：本地 iCloud 目录下的 `node_modules` 偶发缺可选依赖包，直接 `npm test` 可能误报失败。可靠验证方式是复制到 `/tmp` 后 `npm ci`，或重新安装依赖。

## 云端 Demo 部署状态（2026-06-04）

已完成 Render 部署准备：

- `render.yaml`：Render Blueprint，服务名 `nnz-mvp-demo`，rootDir 为 `nnz-mvp`。
- `nnz-mvp/src/demo-server.ts`：支持 `HOST` / `PORT`，默认监听 `0.0.0.0`，并新增 `/healthz`。
- `nnz-mvp/package.json`：新增 `start` 脚本和 Node engines。
- `nnz-mvp-2026-06-04-云端Demo部署交接.md`：完整部署步骤、验收清单和安全边界。
- `nnz-mvp-2026-06-04-云端部署验证与修复.md`：记录 CommonJS 构建产物修复与验证结论。
- `nnz-mvp-2026-06-04-工作记录与下一步安排.md`：今日工作记录、卡点和明日执行顺序。

部署目标是公开 demo 链接，不是生产上线。不要输入真实用户隐私，不要接真实数据库 / 微信 / 支付。LLM Key 只允许走环境变量，不得写入仓库。

如果你是 Claude Code / 其他 AI / 开发者，从这个知识库根目录接手，请先进入当前 MVP 子项目：

```bash
cd "/Users/will/Library/Mobile Documents/iCloud~md~obsidian/Documents/黑曜石知识库/Personal/我还在/nnz-mvp"
```

详细交接文档在：

```text
nnz-mvp/CLAUDE_CODE_HANDOFF.md
```

请优先阅读那份文档。它包含完整的产品意图、Soul 作用域规则、代码结构、环境搭建、运行命令、API 验证、测试覆盖、已知边界和后续计划。

后台治理与 Soul 成熟度架构补充在：

```text
念念在-产品与技术架构：后台治理与Soul成熟度.md
```

这份文档说明了为什么用户端应对 LLM / 封存 / Proposal / Snapshot 等机制无感，而后台需要建设 `Soul Ops Console` 来管理用户、Persona、Memory、Soul 成熟度、风险和迭代策略。

Step 4.5 的实现记录在：

```text
nnz-mvp-Step4.5-SoulOps后台治理实施记录.md
```

这份文档记录了已改文件、验证方式、API 结果、页面确认和下一步 Step 4.6 建议。

Step 1 独立后台雏形和测试数据清理记录在：

```text
nnz-mvp-2026-06-11-Step1-SoulOps独立后台与测试清理.md
```

这份文档记录了 `/ops` 访问方式、`NNZ_OPS_TOKEN`、测试数据清理规则、API 验证结果、浏览器校验、Render 依赖和下一步计划。

## 当前最重要目标

当前 MVP 核心仍是：

> 不同用户拥有不同 Soul。

当前 `nnz-mvp` 已完成 Covenant 生命周期收口：

```text
ACTIVE -> SEALED -> NODE -> SEALED -> GRADUATED
```

最新工程状态、验证方式和注意事项以 `nnz-mvp/CLAUDE_CODE_HANDOFF.md`、`nnz-mvp-CURRENT-STATE.md` 与 `nnz-mvp-2026-06-10-工作记录.md` 为准。

截至当前，步骤二 Memory Vault 分层的基础字段与筛选规则也已落地：Runtime 记忆和 Soul Update 证据分开处理，`RISK` / `RESTRICTED` / `NODE_MEMORY` 不会误用于 Soul 更新。

步骤三 SoulUpdateProposal 审核流程基础版也已落地：提案可列表化、可查看证据、可接受、可拒绝，并通过 fieldPath 白名单限制可更新的 Soul Kernel 字段。Demo 已展示 `oldValue -> newValue`，且 `ACCEPTED` / `REJECTED` 为终态；拒绝后可生成新的独立 `PENDING` 提案。

Soul 的唯一作用域是：

```ts
userId + personaId
```

不要建立全局 `DeceasedSoul`，不要只按 `personaId` 取 Soul，不要把 A 用户的记忆、纠正、节点事件、聊天内容用于 B 用户。

## 快速运行

```bash
cd "/Users/will/Library/Mobile Documents/iCloud~md~obsidian/Documents/黑曜石知识库/Personal/我还在/nnz-mvp"
npm install
npm run typecheck
npm test
npm run demo
```

Demo 地址：

```text
http://127.0.0.1:3007
```

## 当前关键文件

```text
nnz-mvp/src/domain/soul-store.ts
nnz-mvp/src/domain/types.ts
nnz-mvp/src/domain/soul-scope.test.ts
nnz-mvp/src/runtime/soul-runtime.ts
nnz-mvp/src/runtime/soul-runtime.test.ts
nnz-mvp/src/demo-server.ts
nnz-mvp/src/ops/ops-console.ts
nnz-mvp/src/ops/ops-console.test.ts
nnz-mvp/public/index.html
nnz-mvp/CLAUDE_CODE_HANDOFF.md
nnz-mvp-2026-06-11-Step1-SoulOps独立后台与测试清理.md
nnz-mvp-2026-06-10-工作记录.md
nnz-mvp-Step4.5-SoulOps后台治理实施记录.md
念念在-产品与技术架构：后台治理与Soul成熟度.md
```

## 不要破坏的边界

- 所有 Soul / Memory / Snapshot / Node / Conversation 查询必须带 `userId + personaId`。
- A 用户的纠正不能更新 B 用户的 Soul。
- A 用户的节点记忆不能出现在 B 用户检索或聊天里。
- 删除 A 用户数据不能删除 B 用户数据。
- 人物前台回复不能直接说后台机制，例如 `userId`、`personaId`、`节点里的`、`不是我本来就知道`、`按你的记忆`、`检索`、`证据`。

更多细节请看：

```bash
open "nnz-mvp/CLAUDE_CODE_HANDOFF.md"
```
