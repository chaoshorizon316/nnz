# Claude Code Entry: 念念在


## Render 云端 Demo（2026-06-04）

```text
https://nnz-kego.onrender.com
```

免费版无请求 15 分钟会休眠，首次访问需等 30–60 秒唤醒。部署细节见 `nnz-mvp-2026-06-04-云托管完成交接.md`。

## 最新 GitHub / CI / 本地状态（2026-07-01）

GitHub 仓库：

```text
https://github.com/chaoshorizon316/nnz
```

当前时间线：

```text
本次工作开始时远端 main: 1ee270b docs: record soul ops push status
2026-06-11 新增: Render Postgres 已配置并通过重启持久化 smoke
2026-06-11 Step 1: 后台测试数据清理 + 独立 /ops Soul Ops 后台雏形已实现、验证并推送
2026-06-16 新增: Render 已配置 NNZ_OPS_TOKEN，云端 /ops 和 cleanup dry-run smoke 通过
2026-06-16 Step 2.1: Soul Ops 审计日志已实现，本地干净副本 69 tests / build / audit 通过
2026-06-17 Step 2.2: Soul Ops RBAC + 删除回执已实现，本地干净副本 72 tests / build / audit 通过
2026-06-17 Step 2.3: Soul Ops Audit 查询接口 + /ops Audit tab 已实现，本地干净副本 73 tests / build 通过
2026-06-17 Step 2.3 push 后云端验收: GitHub Actions success，Render /ops Audit tab 与 audit-events 401/403 通过
2026-06-18 Step 2.4: ScopedSoulRepository 作用域绑定仓储适配层已实现，本地 typecheck / domain scope tests / build 通过
2026-06-18~21 H5 首页/弹窗方向多轮尝试，最终 main 回退到 modal 前稳定版
2026-06-22 线上与工作区核查：Render healthz/Postgres 正常，Ops audit 无 token 401 正常；当前完整副本在 `黑曜石知识库 2/Personal/我还在`
2026-06-22 H5 修复：`public/index.html` 已把首页 CTA 改回打开 H5 体验 modal，并修复 h5RenderConversation / h5AuthHeaders / h5LoadChatHistory 遗留断点；本地 typecheck、全量测试、build:demo 通过
2026-06-23 H5 创建体验优化：`public/index.html` 已把创建表单 Page 1 改为输入区 + 常用称呼左右结构，强化常用称呼选中态；Page 2 特征项改为复选框式真多选，并保持后端 traits payload 兼容；本地 typecheck、全量测试、build:demo 通过
2026-06-23 H5 修复上线：提交 `5e0df09 fix: restore h5 experience modal` 已推送到 GitHub `main`；GitHub Actions run `28012032867` success；Render `/healthz` 和首页 H5 modal HTML smoke 通过
2026-06-23 Step 2.5: PostgresScopedSoulRepository 最小旁路切片已实现，覆盖 user/persona/memory/conversation 逐表 schema 与强 scope 查询；本地 typecheck、13 个测试文件 84 tests、build 通过；demo runtime 尚未从 snapshot persistence 切换
2026-06-24 Step 2.6: PostgresScopedSoulRepository Covenant 主链旁路切片已实现，覆盖 soul_versions/soul_snapshots/node_events/runtime_sessions 与 seal/activate/complete/graduate lifecycle；本地 typecheck、13 个测试文件 85 tests、build:demo 通过；demo runtime 尚未从 snapshot persistence 切换
2026-06-24 Step 2.7: PostgresScopedSoulRepository 剩余关键表旁路切片已实现，覆盖 soul_update_proposals/credentials/ops_audit_events；本地 typecheck、13 个测试文件 87 tests、build:demo 通过；demo runtime 尚未从 snapshot persistence 切换
2026-06-25 Step 2.8: PostgresScopedSoulRepository 真实 Postgres integration test harness 已实现；默认 npm test 跳过，设置 NNZ_POSTGRES_INTEGRATION_URL 后可验证 schema/JSONB/复合外键/级联删除；本地 typecheck、87 tests + 1 skipped、build:demo 通过
2026-06-25 Step 2.9: snapshot -> scoped tables 离线迁移预检 planner 已实现；输入 StoreSnapshot 输出 table order / row count / blocking errors / warnings；本地 typecheck、90 tests + 1 skipped、build:demo 通过
2026-06-26 Step 2.10: snapshot migration dry-run CLI 已实现；`npm run migration:plan -- <snapshot-json-path>` 支持离线预检、`--json` 和 sanitized `--report`；本地 typecheck、97 tests + 1 skipped、build:demo 通过
2026-06-26 Step 2.11: scoped migration row builder 已实现；通过 planner 后生成按 scoped table 顺序排列的 rows，并在 sanitized report 中输出 rowBuild counts；本地 typecheck、100 tests + 1 skipped、build:demo 通过
2026-06-26 Step 2.12: scoped migration executor core 已实现；显式 confirm 后在事务中执行 schema + ordered upsert inserts，失败 rollback；本地 typecheck、104 tests + 1 skipped、build:demo 通过；当时无线上/CLI 执行入口，后续 Step 2.17 已补本地 protected CLI
2026-06-26 Step 2.13: executor disposable DB integration harness 已实现；仅在设置 NNZ_POSTGRES_INTEGRATION_URL 时连接一次性测试库，默认 skip；本地 typecheck、104 tests + 2 skipped、build:demo 通过；尚未实跑真实测试库
2026-06-26 Step 2.14: executor transaction 已改为 pg client-bound；BEGIN/schema/inserts/COMMIT/ROLLBACK 均使用同一个 checked-out client，finally release；本地 typecheck、104 tests + 2 skipped、build:demo 通过
2026-06-29 Step 2.15: StoreSnapshot export CLI 已实现；`npm run snapshot:export` 支持显式本地 JSON/SQLite 输入导出完整 snapshot，stdout 只输出 counts，已验证可串联 sanitized migration report；本地 typecheck、109 tests + 2 skipped、build:demo 通过
2026-06-30 Step 2.16: migration dry-run sanitized summary 已实现；`npm run migration:plan -- --summary <snapshot-json-path>` 输出聚合 counts/code/table，不含 issue message、邮箱、memory/chat；本地 typecheck、112 tests + 2 skipped、build:demo 通过
2026-07-01 Step 2 migration readiness roadmap 已整理；当时剩余 5 个目标：真实 snapshot dry-run、一次性 Postgres integration run、云端角色 token smoke、protected migration execution runbook、demo runtime scoped tables 切换
2026-07-01 Step 2.17: protected migration execution CLI 已实现；`npm run migration:execute` 默认 dry-run，执行模式只允许 `NNZ_POSTGRES_INTEGRATION_URL` + 显式 confirm，拒绝 `DATABASE_URL` / `NNZ_POSTGRES_URL`；本地 typecheck、118 tests + 2 skipped、build:demo 通过；真实 disposable DB 尚未实跑
2026-07-01 Step 2.18: migration readiness CLI 已实现；`npm run migration:readiness` 从显式本地 JSON/SQLite 一次生成 raw snapshot、sanitized report、sanitized summary，不读取任何 DB env、不连接 Postgres；本地 typecheck、124 tests + 2 skipped、build:demo 通过；真实 snapshot 尚未实跑
2026-07-01 Step 2.19: disposable migration smoke CLI 已实现；`npm run migration:smoke` 只允许 `NNZ_POSTGRES_INTEGRATION_URL` + 显式 confirm，验证 executor 幂等、repository 读回、scope 隔离、audit row、cascade delete 和 cleanup；本地 typecheck、129 tests + 2 skipped、build:demo 通过；真实 disposable DB 尚未实跑
2026-07-01 Step 2.20: runtime persistence mode guardrail 已实现；默认 `snapshot` 路径不变，`NNZ_RUNTIME_PERSISTENCE_MODE=scoped` 需要 `NNZ_POSTGRES_SCOPED_RUNTIME_URL` 且在 adapter 完成前 fail-fast；`/healthz` 和 Ops overview 只暴露 env key / boolean 诊断；本地 typecheck、134 tests + 2 skipped、build:demo 通过
```

说明：

- 6 月 8 日的 SQLite / 登录注册 / 官网首页变更曾让 GitHub Actions 失败。
- 6 月 9 日已修复 typecheck/build、credential 持久化和 credential 删除作用域问题。
- `99c38cb` 已推送到 GitHub，`NNZ MVP CI` success。
- 6 月 10 日本地已把真实验证流程切到首页 H5：注册/登录 -> 创建记忆中的人 -> 私密聊天；新增 `/api/me/*`，用户端不接受前端传 `userId`。
- 6 月 10 日 `/tmp` 干净副本验证：9 个测试文件、64 条测试全绿，typecheck / build / audit 通过；本地 API/browser smoke 通过。
- 6 月 10 日 Render 云端 smoke 通过：首页 `/` 已是 H5 真实用户流，`/demo` 仍是开发者验证页，`/api/me` 未登录 401，跨用户 persona 访问 403，A/B 同名“爸爸”回复不同且无机制词泄露。
- Postgres snapshot persistence 已合入并通过 CI；6 月 11 日已在 Render Web Service `nnz` 配置 `DATABASE_URL` 并重新部署。
- 当前 `/healthz`：`fixture: "postgres"`，`persistence.mode: "postgres"`，`persistence.runtimeMode: "snapshot"`，`persistence.postgresConfigured: true`，`persistence.postgresEnv: "DATABASE_URL"`；诊断只返回 env key / boolean，不返回 URL。
- 6 月 11 日云端持久化 smoke：注册临时测试用户 -> 创建“爸爸” -> 发送一句话 -> Restart service -> 重新登录后 persona 与 2 条 chat-history 均可读回。
- Render runtime logs 已确认：`Postgres persistence configured via DATABASE_URL.` 与 `LLM adapter initialized for extraction pipeline.`。
- 6 月 11 日 Step 1 已实现：新增 `src/ops/ops-console.ts` / `src/ops/ops-console.test.ts`，拆出独立 `/ops` 后台，新增受 `NNZ_OPS_TOKEN` 保护的 `/api/ops/overview` 和 `/api/ops/cleanup-test-users`。
- `/api/ops/cleanup-test-users` 默认 dry-run；真删除必须传 `dryRun:false` 和 `confirm:"DELETE_TEST_USERS"`；只匹配明确 smoke/test 账号并调用 `deleteUserScopedData(userId)`，不会删除 A/B demo 或普通用户。
- 6 月 16 日已在 Render Web Service `nnz` 配置 `NNZ_OPS_TOKEN` 并触发部署。云端 `/ops` 页面 200；`/api/ops/overview` 缺 token 返回 401，错 token 返回 403，带 token 返回 200；cleanup dry-run 返回 1 个 smoke/test 候选且 `deletedUserIds` 为空。
- `NNZ_OPS_TOKEN` 是后台 secret，只存在 Render 环境变量中，不写入仓库或文档。
- 6 月 16 日 Step 2.1 已实现 Soul Ops audit log：记录授权拒绝、overview 查看、cleanup dry-run、cleanup 删除尝试；审计事件随 Postgres snapshot / SQLite 持久化；`/ops` 页面新增 Audit Events 指标和“最近后台操作”面板。
- 本次验证中 `npm audit` 新报 `esbuild <0.28.1` 高危公告，已通过 `overrides.esbuild="^0.28.1"` 最小修复；干净副本 `npm audit` 为 0 vulnerabilities。
- 6 月 17 日 Step 2.2 已实现 Soul Ops RBAC：旧 `NNZ_OPS_TOKEN` 继续作为 admin；新增可选 `NNZ_OPS_VIEWER_TOKEN` / `NNZ_OPS_OPERATOR_TOKEN` / `NNZ_OPS_ADMIN_TOKEN`；viewer 只能读 overview，operator 可 dry-run，admin 可真删除。
- cleanup 真删除现在返回 `receipts` 删除回执；`/ops` 页面新增访问角色面板，并按权限禁用 Dry-run / 确认清理按钮。
- 6 月 17 日 Step 2.3 已实现 Soul Ops Audit 查询：新增 `GET /api/ops/audit-events`、`AUDIT_QUERY` 审计动作、`/ops` 的 Dashboard / Audit tab；Audit tab 支持按 action / actor / targetUserId 查询和分页。
- Step 2.3 本地 API smoke 通过：`GET /ops -> 200`；admin 查询 `AUDIT_QUERY` 返回 200；viewer 查询 audit 返回 200 且仍无 cleanup 删除权限。
- Step 2.3 已推送并完成基础云端验收：GitHub Actions run `27677337466` success；Render `/healthz` 为 Postgres；`/ops` HTML 已包含 Audit tab；`/api/ops/audit-events` 无 token 返回 401、错 token 返回 403。
- Step 2.3 云端角色 token 仍待验证：Render 旧 `NNZ_OPS_TOKEN` 兼容 admin；如已添加 `NNZ_OPS_VIEWER_TOKEN` / `NNZ_OPS_OPERATOR_TOKEN` / `NNZ_OPS_ADMIN_TOKEN`，下一步应做 viewer/operator/admin smoke。不要记录 token 明文。
- 6 月 18 日 Step 2.4 已实现 `ScopedSoulRepository`：通过 `bindSoulRepository(store, { userId, personaId })` 绑定完整 scope 后再执行 Soul / Memory / Snapshot / Proposal / Node / Conversation / Runtime / Maturity 操作，为后续 Postgres scoped repositories 拆分打基础。
- Step 2.4 本地验证：清理旧 `node_modules` 后重新 `npm ci`，`npm run typecheck`、`npm test`、`npm run build:demo`、`npm audit` 全部通过；全量测试为 12 个测试文件、79 tests。
- 6 月 18 日至 21 日另一个 AI 主要围绕 `nnz-mvp/public/index.html` 反复修改 H5 modal / CTA / 三步创建体验；最新提交 `560520f fix: revert index.html to stable version before modal` 已把线上回退到 modal 前稳定内嵌 H5 体验，GitHub Actions run `27902512627` success。
- 6 月 22 日核查确认：Render `/healthz` 返回 200 且 `fixture:"postgres"`；`/api/ops/audit-events` 无 token 返回 401；线上首页当前是内嵌 `#demo` H5 体验，不是 modal。
- 6 月 22 日发现工作区路径异常：Codex 默认路径 `黑曜石知识库/Personal/我还在` 是空壳副本，`.git` 不完整且源码/文档缺失；完整副本位于 `黑曜石知识库 2/Personal/我还在`，该副本 `main...origin/main` 且工作区干净。
- 6 月 22 日已补充核查记录：`nnz-mvp-2026-06-22-线上与工作区核查记录.md`。
- 6 月 22 日已接手并修复 H5 modal / CTA：导航和首屏 CTA 调用 `openExperience(event)`；原 `#demo` 唯一 H5 DOM 改为 modal overlay，避免重复 id；补齐 `h5AuthHeaders()`，修复 `h5RenderConversation()` 三元表达式断点和 `h5LoadChatHistory()` 误调用；验证记录见 `nnz-mvp-2026-06-22-H5体验弹窗与CTA修复记录.md`。
- 6 月 23 日已优化 H5 创建体验：Page 1 改为左右结构并强化常用称呼选中态；Page 2 改为 checkbox 真多选，选中态包含勾选框、底色、边框和阴影；创建人格描述保留全部多选特征，提交给后端的 `traits` 仍保持当前字符串兼容。验证记录见 `nnz-mvp-2026-06-23-H5创建体验选项交互优化.md`。
- 6 月 23 日 H5 修复已上线：提交 `5e0df09 fix: restore h5 experience modal` 已推送；GitHub Actions run `28012032867` success；Render `/healthz` 为 Postgres；线上首页 HTML 已包含 `openExperience(event)`、`.nnz-experience-modal[hidden]`、`trait-check` 和 `h5-trait-options`。
- 6 月 23 日 Step 2.5 已实现 `PostgresScopedSoulRepository`：新增 `nnz_users`、`nnz_personas`、`nnz_memory_items`、`nnz_conversation_messages` 最小逐表 schema；repository 构造时绑定完整 `userId + personaId`；memory/conversation 读写强制按双字段 scope 查询；fake Postgres pool 测试覆盖同名 persona 隔离、跨 owner 拒绝、caller-supplied id 不覆盖绑定 scope、memory filter 默认规则。当前仍是旁路实现，尚未替换 demo runtime 的 Postgres snapshot persistence。
- 6 月 24 日 Step 2.6 已扩展 `PostgresScopedSoulRepository`：新增 `nnz_soul_versions`、`nnz_soul_snapshots`、`nnz_node_events`、`nnz_runtime_sessions`；实现 create/list/get soul version、snapshot、node、runtime session 与 seal/activate/complete/graduate；fake Postgres pool 测试覆盖 current scope 归档、snapshot memoryIds、node 复用与完成、跨 scope node 拒绝。当前仍是旁路实现，尚未替换 demo runtime 的 Postgres snapshot persistence。
- 6 月 24 日 Step 2.7 已补齐 `PostgresScopedSoulRepository` 剩余关键表：新增 `nnz_soul_update_proposals`、`nnz_credentials`、`nnz_ops_audit_events`；实现 proposal 创建/列表/证据/接受/拒绝、credential 存取、ops audit 记录/列表；fake Postgres pool 测试覆盖 cross-scope evidence 拒绝、terminal proposal 状态、credential user 绑定、audit metadata 不含 credential/chat。当前仍是旁路实现，尚未替换 demo runtime 的 Postgres snapshot persistence。
- 6 月 25 日 Step 2.8 已新增真实 Postgres integration test harness：`src/domain/postgres-scoped-soul-repository.integration.test.ts` 只读取 `NNZ_POSTGRES_INTEGRATION_URL`，默认 skip；有一次性测试库时可验证真实 schema、JSONB round-trip、复合外键拒绝跨 scope snapshot / memory、cross-scope evidence/node 拒绝、user 删除级联，以及 OpsAudit 全局保留。当前仍未替换 demo runtime 的 Postgres snapshot persistence。
- 6 月 25 日 Step 2.9 已新增 snapshot -> scoped tables 离线迁移预检 planner：`src/domain/postgres-scoped-migration-plan.ts` / `src/domain/postgres-scoped-migration-plan.test.ts`；输入 `StoreSnapshot` 输出 table order、row count、blocking errors 和 warnings；测试覆盖有效快照、跨 scope 引用阻断、missing owner、OpsAudit missing target warning、重复 ACTIVE SoulVersion。当前仍不读取 `DATABASE_URL`、不连接 Render、不写线上库。
- 6 月 26 日 Step 2.10 已新增 snapshot migration dry-run CLI：`src/tools/postgres-scoped-migration-plan-cli.ts` 支持本地 `StoreSnapshot` JSON、`--json` 和 sanitized `--report`；不读取数据库环境变量，不连接 Postgres。
- 6 月 26 日 Step 2.11 已新增 scoped migration row builder：`src/domain/postgres-scoped-migration-rows.ts` 在 planner ready 后生成按目标表顺序排列的 rows；sanitized report 只输出 rowBuild counts，不输出 rows 或 memory/chat 正文。
- 6 月 26 日 Step 2.12 已新增 scoped migration executor core：`src/domain/postgres-scoped-migration-executor.ts` 需要显式 `EXECUTE_POSTGRES_SCOPED_MIGRATION` confirm，在一个 transaction 中执行 schema + ordered upsert inserts，失败 rollback；无 CLI 执行入口，不读取 `DATABASE_URL`。
- 6 月 26 日 Step 2.13 已新增 executor disposable DB integration harness：`src/domain/postgres-scoped-migration-executor.integration.test.ts` 只读取 `NNZ_POSTGRES_INTEGRATION_URL`，默认 skip；有一次性测试库时验证 executor 幂等写入、repository 读回、scope 隔离和级联删除。
- 6 月 26 日 Step 2.14 已修正 executor 事务边界：`executePostgresScopedMigration(...)` 使用 `pool.connect()` checked-out client 运行 BEGIN/schema/inserts/COMMIT/ROLLBACK，并在 finally release；避免真实 `pg.Pool#query()` 多连接导致事务不绑定。
- 6 月 29 日 Step 2.15 已新增 StoreSnapshot export CLI：`src/tools/store-snapshot-export-cli.ts` / `src/tools/store-snapshot-export-cli.test.ts`；`npm run snapshot:export` 只从显式本地 JSON/SQLite 文件导出完整 snapshot，stdout 只输出 counts，不读取数据库环境变量、不连接 Postgres。
- 6 月 30 日 Step 2.16 已新增 sanitized migration summary：`npm run migration:plan -- --summary <snapshot-json-path>` 只输出聚合 counts/code/table 和 nextAction，不输出 issue message、row id、email、memory/chat 正文。
- 本地干净副本验证：`/tmp/nnz-step1-final.MF0YVg` 中 `npm ci`、`npm run typecheck`、`npm test`、`npm run build:demo`、`npm audit` 全部通过，10 个测试文件、67 条测试全绿，0 vulnerabilities。
- 本地 `/ops` browser smoke 通过：输入 `dev-ops-token` 后显示 8 个核心指标、用户表、2 个 Persona 成熟度卡片和测试数据清理面板。
- Step 1 已推送到 GitHub：`30685df feat: add protected soul ops console`，当前本地与远端同步：`main...origin/main`。

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

2026-06-16 结果：Render 云端 `/ops` 已启用，权限边界和 cleanup dry-run smoke 通过。记录见 `nnz-mvp-2026-06-16-SoulOps云端启用记录.md`。

2026-06-16 Step 2.1 结果：`/tmp/nnz-audit-verify.Pm31Tw` 干净副本中 `npm ci`、`npm run typecheck`、`npm test`、`npm run build:demo`、`npm audit` 全部通过；10 个测试文件、69 条测试全绿；本地 `/api/ops` smoke 确认 401/403/overview/cleanup dry-run 均写入 audit。记录见 `nnz-mvp-2026-06-16-Step2.1-SoulOps审计日志.md`。

2026-06-17 Step 2.2 结果：`/tmp/nnz-step22-verify.jyhpib` 干净副本中 `npm ci`、`npm run typecheck`、`npm test`、`npm run build:demo`、`npm audit` 全部通过；11 个测试文件、72 条测试全绿；本地 API smoke 确认 viewer/operator/admin 权限边界和删除回执。记录见 `nnz-mvp-2026-06-17-Step2.2-SoulOps-RBAC与删除回执.md`。

2026-06-17 Step 2.3 结果：`/tmp/nnz-step23-verify.iLBxJh` 干净副本中 `npm ci`、`npm test`、`npm run typecheck`、`npm run build:demo` 全部通过；11 个测试文件、73 条测试全绿；本地 API smoke 确认 `/api/ops/audit-events`、Audit tab HTML、viewer/admin 审计查询。记录见 `nnz-mvp-2026-06-17-Step2.3-SoulOps-Audit查询与角色云端验证.md`。

2026-06-17 Step 2.3 push 后云端验收：GitHub Actions success；Render `GET /healthz` 返回 `fixture:"postgres"`；`GET /ops` 返回 200 且包含 Audit tab；`GET /api/ops/audit-events` 无 token 401、错 token 403。记录见 `nnz-mvp-2026-06-17-Step2.3-推送后云端验收记录.md`。

2026-06-18 Step 2.4 结果：新增 `src/domain/scoped-soul-repository.ts` / `src/domain/scoped-soul-repository.test.ts`，绑定 `userId + personaId` 后提供作用域内 Soul / Memory / Proposal / Node / Conversation / Covenant / Runtime / Maturity 操作；本地 `npm ci`、typecheck、全量测试、build:demo 和 audit 通过。记录见 `nnz-mvp-2026-06-18-Step2.4-ScopedSoulRepository作用域仓储.md`。

2026-06-22 结果：完成线上与本地工作区核查。线上 Render healthz/Postgres 正常，Soul Ops audit 无 token 401 正常；GitHub `main` 最新为 `560520f` 且 CI 成功；另一个 AI 主要做 H5 modal/CTA 多轮尝试后回退稳定版；当前 Codex 默认 workspace 是空壳副本，完整工作区在 `黑曜石知识库 2/Personal/我还在`。记录见 `nnz-mvp-2026-06-22-线上与工作区核查记录.md`。

2026-06-22 H5 修复结果：完整工作区中已执行 `npm ci` 干净重装，`better-sqlite3` 确认为 arm64；`npm run typecheck`、`npm test`、`npm run build:demo` 全部通过，全量测试为 12 个测试文件、79 tests；本地 demo healthz 通过，modal JS 冒烟通过。记录见 `nnz-mvp-2026-06-22-H5体验弹窗与CTA修复记录.md`。2026-06-23 已通过 `5e0df09` 推送上线。

2026-06-23 H5 创建体验优化结果：`node` 内联脚本 smoke、`git diff --check`、`npm run typecheck`、`npm test`、`npm run build:demo`、H5 多选行为 smoke 均通过；全量测试为 12 个测试文件、79 tests。记录见 `nnz-mvp-2026-06-23-H5创建体验选项交互优化.md`。已通过 `5e0df09` 推送上线，GitHub Actions run `28012032867` success，Render 首页 HTML smoke 通过。

2026-06-23 Step 2.5 Postgres scoped repository 结果：新增 `src/domain/postgres-scoped-soul-repository.ts` / `src/domain/postgres-scoped-soul-repository.test.ts`，完成 Persona / Memory / Conversation 的最小逐表 Postgres repository 旁路切片；本地 `npm run typecheck`、`npm test`、`npm run build` 通过，全量测试为 13 个测试文件、84 tests。记录见 `nnz-mvp-2026-06-23-Step2.5-PostgresScopedRepository计划.md`。

2026-06-24 Step 2.6 Postgres scoped Covenant 结果：继续扩展 `src/domain/postgres-scoped-soul-repository.ts` / `src/domain/postgres-scoped-soul-repository.test.ts`，完成 SoulVersion / SoulSnapshot / NodeEvent / RuntimeSession 的 Covenant 主链旁路切片；本地 `npm run typecheck`、`npm test`、`npm run build:demo` 通过，全量测试为 13 个测试文件、85 tests。记录见 `nnz-mvp-2026-06-24-Step2.6-PostgresScopedCovenant计划.md`。

2026-06-24 Step 2.7 Postgres scoped 剩余表结果：继续扩展 `src/domain/postgres-scoped-soul-repository.ts` / `src/domain/postgres-scoped-soul-repository.test.ts`，完成 SoulUpdateProposal / Credential / OpsAuditEvent 的逐表旁路切片；本地 `npm run typecheck`、`npm test`、`npm run build:demo` 通过，全量测试为 13 个测试文件、87 tests。记录见 `nnz-mvp-2026-06-24-Step2.7-PostgresScoped剩余表计划.md`。

2026-06-25 Step 2.8 Postgres integration harness 结果：新增 `src/domain/postgres-scoped-soul-repository.integration.test.ts`，默认跳过；设置 `NNZ_POSTGRES_INTEGRATION_URL` 后可连接一次性测试库验证 schema / JSONB / 复合外键 / 级联删除。本地 `npm run typecheck`、`npm test`、`npm run build:demo` 通过，全量为 13 个测试文件、87 tests，另有 1 个 integration 文件 skipped。记录见 `nnz-mvp-2026-06-25-Step2.8-PostgresIntegration测试计划.md`。

2026-06-25 Step 2.9 snapshot -> scoped tables 迁移预检结果：新增 `src/domain/postgres-scoped-migration-plan.ts` / `src/domain/postgres-scoped-migration-plan.test.ts`，完成纯函数 dry-run planner；本地 `npm run typecheck`、targeted migration planner test、`npm test`、`npm run build:demo` 通过，全量为 14 个测试文件、90 tests，另有 1 个 integration 文件 skipped。记录见 `nnz-mvp-2026-06-25-Step2.9-SnapshotToScopedTables迁移预检.md`。

2026-06-26 Step 2.10 snapshot migration dry-run CLI 结果：新增 `src/tools/postgres-scoped-migration-plan-cli.ts` / `src/tools/postgres-scoped-migration-plan-cli.test.ts`，完成离线 planner CLI、`--json` 和 sanitized `--report`；本地 `npm run typecheck`、targeted CLI test、`npm test`、`npm run build:demo` 通过，全量为 15 个测试文件、97 tests，另有 1 个 integration 文件 skipped。记录见 `nnz-mvp-2026-06-26-Step2.10-SnapshotDryRunCLI.md`。

2026-06-26 Step 2.11 scoped migration row builder 结果：新增 `src/domain/postgres-scoped-migration-rows.ts` / `src/domain/postgres-scoped-migration-rows.test.ts`，完成 planner-ready 后的 scoped table row builder，并接入 sanitized report 的 rowBuild counts；本地 `npm run typecheck`、targeted row builder/CLI test、`npm test`、`npm run build:demo` 通过，全量为 16 个测试文件、100 tests，另有 1 个 integration 文件 skipped。记录见 `nnz-mvp-2026-06-26-Step2.11-ScopedMigrationRows.md`。

2026-06-26 Step 2.12 scoped migration executor core 结果：新增 `src/domain/postgres-scoped-migration-executor.ts` / `src/domain/postgres-scoped-migration-executor.test.ts`，完成显式 confirm、transaction、ordered inserts/upserts、rollback 与 sanitized report executor section；本地 `npm run typecheck`、targeted executor/CLI test、`npm test`、`npm run build:demo` 通过，全量为 17 个测试文件、104 tests，另有 1 个 integration 文件 skipped。记录见 `nnz-mvp-2026-06-26-Step2.12-ScopedMigrationExecutor.md`。

2026-06-26 Step 2.13 executor disposable DB integration harness 结果：新增 `src/domain/postgres-scoped-migration-executor.integration.test.ts`，默认跳过；设置 `NNZ_POSTGRES_INTEGRATION_URL` 后可连接一次性测试库验证 executor 真实写入、幂等、repository 读回、scope 隔离和级联删除。本地 `npm run typecheck`、targeted executor integration test、`npm test`、`npm run build:demo` 通过，全量为 17 个测试文件、104 tests，另有 2 个 integration 文件 skipped。记录见 `nnz-mvp-2026-06-26-Step2.13-ExecutorIntegrationHarness.md`。

2026-06-26 Step 2.14 executor client-bound transaction 结果：修改 `src/domain/postgres-scoped-migration-executor.ts` 与 repository query 类型，确保真实 pg executor 在 checked-out client 上执行 BEGIN/schema/inserts/COMMIT/ROLLBACK，并在成功/失败路径 release；本地 typecheck、targeted executor test、全量 test/build 已在后续 Step 2.15/2.16 验证通过。记录见 `nnz-mvp-2026-06-26-Step2.14-ExecutorClientTransaction.md`。

2026-06-29 Step 2.15 StoreSnapshot export CLI 结果：新增 `src/tools/store-snapshot-export-cli.ts` / `src/tools/store-snapshot-export-cli.test.ts`，新增 `snapshot:export` script；支持显式本地 JSON/SQLite 输入导出完整 snapshot，stdout 只输出 counts，并已通过 `snapshot:export` -> `migration:plan -- --report` smoke 确认 sanitized report 不含测试 memory/chat 正文。本地 `npm run typecheck`、targeted CLI tests、`npm test`、`npm run build:demo`、`git diff --check` 通过，全量为 18 个测试文件、109 tests，另有 2 个 integration 文件 skipped。记录见 `nnz-mvp-2026-06-29-Step2.15-StoreSnapshotExportCLI.md`。

2026-06-30 Step 2.16 sanitized migration summary 结果：`src/tools/postgres-scoped-migration-plan-cli.ts` 新增 `--summary` 与 report summary 字段；summary 只输出聚合 counts/code/table 和 nextAction，不输出 issue message、row id、email、memory/chat 正文。本地 `npm run typecheck`、targeted CLI tests、summary smoke、`npm test`、`npm run build:demo`、`git diff --check` 通过，全量为 18 个测试文件、112 tests，另有 2 个 integration 文件 skipped。记录见 `nnz-mvp-2026-06-30-Step2.16-SanitizedMigrationSummary.md`。

2026-07-01 Step 2 migration readiness roadmap：新增 `nnz-mvp-2026-07-01-Step2-MigrationReadinessRoadmap.md`，当时明确剩余 5 个目标、完成标准、推荐顺序和安全边界；Step 2.17 后已更新为剩余 4 个未完成目标。当前无需每个小步骤都 push；应按目标连续推进，遇到真实 snapshot、disposable DB URL、云端 token 等外部输入点再做明确 checkpoint。

2026-07-01 Step 2.17 protected migration execution CLI 结果：新增 `src/tools/postgres-scoped-migration-execute-cli.ts` / `src/tools/postgres-scoped-migration-execute-cli.test.ts`，新增 `migration:execute` script；默认 dry-run 不建 pool、不连库，执行模式必须同时传 `--execute`、`--database-url-env NNZ_POSTGRES_INTEGRATION_URL`、`--confirm EXECUTE_POSTGRES_SCOPED_MIGRATION`；拒绝 `DATABASE_URL` / `NNZ_POSTGRES_URL`，blocking errors 拒绝执行，warnings 默认拒绝，stdout/report 不含 memory/chat、credential hash、DB URL 或 rows。本地 `npm run typecheck`、targeted 20 tests、`npm test`、`npm run build:demo`、CLI help 通过；全量为 19 个测试文件、118 tests，另有 2 个 integration 文件 skipped。记录见 `nnz-mvp-2026-07-01-Step2.17-ProtectedMigrationExecuteCLI.md`。

2026-07-01 Step 2.18 migration readiness CLI 结果：新增 `src/tools/postgres-scoped-migration-readiness-cli.ts` / `src/tools/postgres-scoped-migration-readiness-cli.test.ts`，新增 `migration:readiness` script；从显式 `--from-json` 或 `--from-sqlite` 输入一次生成 raw snapshot、sanitized report、sanitized summary；默认拒绝覆盖、拒绝输出路径重复、拒绝输出覆盖输入；不读取 `DATABASE_URL` / `NNZ_POSTGRES_URL` / `NNZ_POSTGRES_INTEGRATION_URL`，不连接 Postgres。raw snapshot 可能含敏感数据，summary/report 不含 memory/chat、credential hash 或 rows。本地 `npm run typecheck`、targeted 27 tests、`npm test`、`npm run build:demo`、CLI help 通过；全量为 20 个测试文件、124 tests，另有 2 个 integration 文件 skipped。记录见 `nnz-mvp-2026-07-01-Step2.18-MigrationReadinessCLI.md`。

2026-07-01 Step 2.19 disposable migration smoke CLI 结果：新增 `src/tools/postgres-scoped-migration-smoke-cli.ts` / `src/tools/postgres-scoped-migration-smoke-cli.test.ts`，新增 `migration:smoke` script；必须传 `--database-url-env NNZ_POSTGRES_INTEGRATION_URL` 和 `--confirm RUN_POSTGRES_SCOPED_MIGRATION_SMOKE`；拒绝 `DATABASE_URL` / `NNZ_POSTGRES_URL`；构造双 user/persona fixture，执行 scoped migration 两次验证幂等，通过 repository 读回 runtime/snapshot/memory/conversation/proposal/credential，验证 cross-scope node conversation 拒绝、audit row 写入、user delete cascade、sibling scope preserved，并 finally 清理 fixture users/audit rows。stdout/失败输出不含 DB URL、fixture memory/chat、credential hash、row payload 或 raw DB error details。本地 `npm run typecheck`、targeted 21 tests、`npm test`、`npm run build:demo`、CLI help 通过；全量为 21 个测试文件、129 tests，另有 2 个 integration 文件 skipped。记录见 `nnz-mvp-2026-07-01-Step2.19-DisposableMigrationSmokeCLI.md`。

2026-07-01 Step 2.20 runtime persistence mode guardrail 结果：新增 `src/runtime-persistence-config.ts` / `src/runtime-persistence-config.test.ts`，`src/demo-server.ts` 改为通过配置模块选择 runtime persistence；默认 `snapshot` 路径不变，`scoped` 模式必须使用 `NNZ_POSTGRES_SCOPED_RUNTIME_URL` 且在 adapter 完成前 fail-fast；`/healthz` 和 Ops overview 只返回 `runtimeMode`、env key、boolean 和非敏感状态原因，不返回 URL/token/正文/rows。本地 `npm run typecheck`、targeted runtime config/Ops tests、`npm test`、`npm run build:demo`、`git diff --check` 通过；全量为 22 个测试文件、134 tests，另有 2 个 integration 文件 skipped。记录见 `nnz-mvp-2026-07-01-Step2.20-RuntimePersistenceModeGuardrail.md`。

最新 CI run：

```text
https://github.com/chaoshorizon316/nnz/actions/runs/28012032867
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

Soul Ops 云端启用记录在：

```text
nnz-mvp-2026-06-16-SoulOps云端启用记录.md
```

这份文档记录了 Render `NNZ_OPS_TOKEN` 配置、云端 `/ops` 权限 smoke、cleanup dry-run 结果和下一步 audit log / RBAC / scoped repository 计划。文档不记录 token 明文。

Soul Ops 审计日志记录在：

```text
nnz-mvp-2026-06-16-Step2.1-SoulOps审计日志.md
```

这份文档记录了 `OpsAuditEvent` 类型、持久化方式、`/ops` 页面变化、验证结果、`esbuild` audit 修复和下一步 RBAC / 删除回执计划。

Soul Ops RBAC 与删除回执记录在：

```text
nnz-mvp-2026-06-17-Step2.2-SoulOps-RBAC与删除回执.md
```

Soul Ops Audit 查询与角色云端验证记录在：

```text
nnz-mvp-2026-06-17-Step2.3-SoulOps-Audit查询与角色云端验证.md
```

Step 2.3 推送后云端验收记录在：

```text
nnz-mvp-2026-06-17-Step2.3-推送后云端验收记录.md
```

这份文档记录了 viewer/operator/admin 角色、向后兼容旧 `NNZ_OPS_TOKEN`、删除回执、API smoke、干净副本验证和下一步云端角色化配置计划。

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
nnz-mvp/src/runtime-persistence-config.ts
nnz-mvp/src/runtime-persistence-config.test.ts
nnz-mvp/src/ops/ops-console.ts
nnz-mvp/src/ops/ops-console.test.ts
nnz-mvp/public/index.html
nnz-mvp/CLAUDE_CODE_HANDOFF.md
nnz-mvp-2026-07-01-Step2.20-RuntimePersistenceModeGuardrail.md
nnz-mvp-2026-07-01-Step2.19-DisposableMigrationSmokeCLI.md
nnz-mvp-2026-07-01-Step2.18-MigrationReadinessCLI.md
nnz-mvp-2026-07-01-Step2.17-ProtectedMigrationExecuteCLI.md
nnz-mvp-2026-07-01-Step2-MigrationReadinessRoadmap.md
nnz-mvp-2026-06-30-Step2.16-SanitizedMigrationSummary.md
nnz-mvp-2026-06-29-Step2.15-StoreSnapshotExportCLI.md
nnz-mvp-2026-06-26-Step2.14-ExecutorClientTransaction.md
nnz-mvp-2026-06-17-Step2.2-SoulOps-RBAC与删除回执.md
nnz-mvp-2026-06-16-Step2.1-SoulOps审计日志.md
nnz-mvp-2026-06-16-SoulOps云端启用记录.md
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
