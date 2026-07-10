# nnz-mvp 当前状态与交接指南

> 更新：2026-07-10
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
2026-06-23 H5 修复上线：`5e0df09 fix: restore h5 experience modal` 已推送到 GitHub `main`；GitHub Actions run `28012032867` success；Render `/healthz` 与首页 H5 modal HTML smoke 通过
2026-06-23 Step 2.5: PostgresScopedSoulRepository 最小旁路切片已实现，覆盖 user/persona/memory/conversation 逐表 schema 与强 scope 查询；本地 typecheck、13 个测试文件 84 tests、build 通过；demo runtime 尚未从 snapshot persistence 切换
2026-06-24 Step 2.6: PostgresScopedSoulRepository Covenant 主链旁路切片已实现，覆盖 soul_versions/soul_snapshots/node_events/runtime_sessions 与 seal/activate/complete/graduate lifecycle；本地 typecheck、13 个测试文件 85 tests、build:demo 通过；demo runtime 尚未从 snapshot persistence 切换
2026-06-24 Step 2.7: PostgresScopedSoulRepository 剩余关键表旁路切片已实现，覆盖 soul_update_proposals/credentials/ops_audit_events；本地 typecheck、13 个测试文件 87 tests、build:demo 通过；demo runtime 尚未从 snapshot persistence 切换
2026-06-25 Step 2.8: PostgresScopedSoulRepository 真实 Postgres integration test harness 已实现；默认 npm test 跳过，设置 NNZ_POSTGRES_INTEGRATION_URL 后可验证 schema/JSONB/复合外键/级联删除；本地 typecheck、13 个测试文件 87 tests + 1 skipped、build:demo 通过
2026-06-25 Step 2.9: snapshot -> scoped tables 离线迁移预检 planner 已实现；输入 StoreSnapshot 输出 table order / row count / blocking errors / warnings；覆盖跨 scope 引用、credential user 绑定、重复 ACTIVE SoulVersion、OpsAudit missing target warning；本地 typecheck、14 个测试文件 90 tests + 1 skipped、build:demo 通过
2026-06-26 Step 2.10: snapshot migration dry-run CLI 已实现；`npm run migration:plan -- <snapshot-json-path>` 可离线审阅 StoreSnapshot / snapshot_json wrapper 的 row count、warnings、errors；`--report` 可生成不含 memory/chat 正文的 sanitized JSON report；本地 typecheck、15 个测试文件 97 tests + 1 skipped、build:demo 通过
2026-06-26 Step 2.11: scoped migration row builder 已实现；通过预检后可生成按目标 scoped table 顺序排列的 rows，并接入 sanitized report 的 rowBuild counts；本地 typecheck、16 个测试文件 100 tests + 1 skipped、build:demo 通过
2026-06-26 Step 2.12: scoped migration executor core 已实现；显式 confirm 后可在事务中按 row builder 顺序执行 schema + upsert inserts，失败 rollback；本地 typecheck、17 个测试文件 104 tests + 1 skipped、build:demo 通过；当时无线上/CLI 执行入口，后续 Step 2.17 已补本地 protected CLI
2026-06-26 Step 2.13: executor disposable DB integration harness 已实现；默认跳过，仅在设置 NNZ_POSTGRES_INTEGRATION_URL 时连接一次性 Postgres 测试库，覆盖 executor 幂等写入、repository 读回、scope 隔离和级联删除；本地 typecheck、17 个测试文件 104 tests + 2 skipped、build:demo 通过；目前仍未实跑真实测试库
2026-06-26 Step 2.14: executor transaction 已改为 pg client-bound；BEGIN/schema/inserts/COMMIT/ROLLBACK 均使用同一个 checked-out client，finally release；本地 typecheck、17 个测试文件 104 tests + 2 skipped、build:demo 通过
2026-06-29 Step 2.15: StoreSnapshot export CLI 已实现；`npm run snapshot:export` 支持显式本地 JSON/SQLite 输入导出完整 snapshot，stdout 只输出 counts，已验证可串联 sanitized migration report；本地 typecheck、18 个测试文件 109 tests + 2 skipped、build:demo 通过
2026-06-30 Step 2.16: migration dry-run sanitized summary 已实现；`npm run migration:plan -- --summary <snapshot-json-path>` 输出聚合 counts/code/table，不含 issue message、邮箱、memory/chat；本地 typecheck、18 个测试文件 112 tests + 2 skipped、build:demo 通过
2026-07-01 Step 2 migration readiness roadmap 已整理；当时剩余 5 个目标，其中真实 snapshot dry-run、一次性 Postgres integration run、云端角色 token smoke 依赖外部输入，protected execution runbook 和 runtime scoped tables 切换可继续本地推进
2026-07-01 Step 2.17: protected migration execution CLI 已实现；`npm run migration:execute` 默认 dry-run，执行模式只允许 `NNZ_POSTGRES_INTEGRATION_URL` + 显式 confirm，拒绝 `DATABASE_URL` / `NNZ_POSTGRES_URL`；本地 typecheck、19 个测试文件 118 tests + 2 skipped、build:demo 通过；真实 disposable DB 尚未实跑
2026-07-01 Step 2.18: migration readiness CLI 已实现；`npm run migration:readiness` 可从显式本地 JSON/SQLite 一次生成 raw snapshot、sanitized report、sanitized summary，不读取任何 DB env、不连接 Postgres；本地 typecheck、20 个测试文件 124 tests + 2 skipped、build:demo 通过；真实 snapshot 尚未实跑
2026-07-01 Step 2.19: disposable migration smoke CLI 已实现；`npm run migration:smoke` 只允许 `NNZ_POSTGRES_INTEGRATION_URL` + 显式 confirm，验证 executor 幂等、repository 读回、scope 隔离、audit row、cascade delete 和 cleanup；本地 typecheck、21 个测试文件 129 tests + 2 skipped、build:demo 通过；真实 disposable DB 尚未实跑
2026-07-01 Step 2.20: runtime persistence mode guardrail 已实现；默认 `snapshot` 路径不变，`NNZ_RUNTIME_PERSISTENCE_MODE=scoped` 需要 `NNZ_POSTGRES_SCOPED_RUNTIME_URL` 且在 adapter 完成前 fail-fast；`/healthz` 和 Ops overview 只暴露 env key / boolean 诊断；本地 typecheck、22 个测试文件 134 tests + 2 skipped、build:demo 通过
2026-07-02 Step 2.21: migration guardrail hardening 已实现；`migration:execute` / `migration:smoke` 会拒绝 `NNZ_POSTGRES_INTEGRATION_URL` 与 `DATABASE_URL` / `NNZ_POSTGRES_URL` 值相同的生产别名误配，pool close failure 只输出固定脱敏错误；本地 typecheck、22 个测试文件 138 tests + 2 skipped、build:demo 通过
2026-07-03 Step 2.22: scoped runtime adapter foundation 已实现；新增 InMemory/Postgres 双后端 `ScopedRuntimeAdapter`，覆盖 auth credential、persona、conversation、runtime context、Covenant NODE/SEALED/GRADUATED 的切换接口；本地 typecheck、141 tests + 2 skipped、build:demo 通过
2026-07-03 Step 2.23: `/api/me/*` 用户端 flow 已接入 InMemory scoped runtime adapter；注册/登录 credential、persona 创建/列表、chat/history、Covenant seal/activate/complete/graduate 走 adapter 形状；默认 snapshot persistence 不变；本地 typecheck、141 tests + 2 skipped、build:demo、API smoke 通过
2026-07-03 Step 2.24: guarded scoped runtime Postgres adapter mode 已实现；`NNZ_RUNTIME_PERSISTENCE_MODE=scoped` 只读取 `NNZ_POSTGRES_SCOPED_RUNTIME_URL`，启动时确保 scoped schema 并把 `/api/me/*` runtime adapter 指向 Postgres scoped tables；缺专用 URL 仍 fail-fast；本地 typecheck、142 tests + 2 skipped、build:demo、默认 API smoke 通过
2026-07-03 Step 2.25: scoped runtime smoke guard 已实现；`NNZ_POSTGRES_SCOPED_RUNTIME_URL` 会拒绝与 `DATABASE_URL` / `NNZ_POSTGRES_URL` 同值的生产别名误配；新增 `runtime:smoke`，只允许专用 scoped URL + 显式 confirm，验证 credential/persona/runtime context/Covenant/cross-scope/cascade/cleanup，输出脱敏；本地 typecheck、151 tests + 2 skipped、build:demo 通过
2026-07-03 Step 2.26: scoped Ops cleanup/audit cutover slice 已实现；scoped mode 下 Ops cleanup dry-run/confirm 与 audit write/query 可走 scoped Postgres tables，同一个 scoped runtime pool；本地 typecheck、154 tests + 2 skipped、build:demo 通过
2026-07-06 Step 2.27: scoped Ops overview aggregation 已实现；scoped mode 下 `/api/ops/overview` users/personas/maturity 聚合走 scoped Postgres tables，并复用现有 maturity 算法；本地 typecheck、155 tests + 2 skipped、build:demo 通过
2026-07-06 Step 2.28: user data export/delete cutover 已实现；`/api/me/export` 与 `/api/me/delete` 走 `ScopedRuntimeAdapter`，scoped mode 下可用 Postgres scoped tables，导出不含 credential hash/后台审计，删除只删当前登录用户；本地 typecheck、157 tests、build:demo、API smoke 通过
2026-07-06 Step 2.29: scoped runtime HTTP smoke CLI 已实现；新增 `runtime:http-smoke`，用 disposable `NNZ_POSTGRES_SCOPED_RUNTIME_URL` 启动真实 demo server 并跑 `/api/me/*` register/persona/chat/history/Covenant/export/delete HTTP 链路；清空 child `NNZ_LLM_*`、拒绝生产别名误配并输出脱敏；本地 typecheck、165 tests + 2 skipped、build:demo、CLI help 通过
2026-07-06 Step 2.30: scoped runtime smoke suite 已实现；新增 `runtime:smoke-suite`，把 direct adapter smoke、`build:demo`、HTTP `/api/me/*` smoke 合并成一个受保护命令；本地 typecheck、175 tests + 2 skipped、build:demo、CLI help 通过
2026-07-06 Step 2.31: migration validation suite 已实现；新增 `migration:validation-suite`，先跑真实 snapshot readiness，干净后再跑 disposable Postgres migration smoke；本地 typecheck、183 tests + 2 skipped、build:demo、CLI help 通过
2026-07-06 Step 2.32: Ops role token smoke CLI 已实现；新增 `ops:role-smoke`，验证 viewer/operator/admin token 权限边界，默认非破坏性，确认删除 smoke 需要第二道 confirm；本地 typecheck、190 tests + 2 skipped、build:demo、CLI help 通过
2026-07-07 Step 2.33: release preflight CLI 已实现；新增 `release:preflight`，在不读 snapshot、不连 DB、不触网的情况下汇总剩余三类外部实跑的本地前置条件；本地 typecheck、196 tests + 2 skipped、build:demo、CLI help 通过
2026-07-07 Step 2.34: release validation suite CLI 已实现；新增 `release:validation-suite`，先跑 preflight，再串 migration validation、默认非破坏性 Ops role smoke、scoped runtime smoke suite；本地 typecheck、204 tests + 2 skipped、build:demo、CLI help 通过
2026-07-07 Step 2.35: release validation evidence option 已实现并推送；`release:validation-suite` 新增可选 `--evidence-out`，成功或确认后的 stage 失败都会写脱敏 evidence JSON，只含 stage 状态、env key 名和本地产物类别，不含 snapshot 路径、DB URL、token、用户内容、child output、server log 或 raw error details；本地 typecheck、206 tests + 2 skipped、build:demo、CLI help、当前环境 preflight-blocked evidence smoke、git diff --check 通过
2026-07-07 Step 2.36: sensitive local release safety 已实现并推送；`.gitignore` 显式忽略 SQLite/DB 文件、raw/report/summary/evidence JSON、migration/release/snapshot artifact 目录，防止真实 snapshot、readiness/report/evidence 本地产物误提交；新增 `nnz-mvp/.env.example`，只列空 env key 和 disposable DB 安全注释；check-ignore 已验证不影响 package/tsconfig/Markdown/env template；本地 typecheck、206 tests + 2 skipped、build:demo、git diff --check 通过
2026-07-07 Step 2.37: H5 graduation export + safety support UX 已实现并推送；毕业按钮会先导出当前登录用户的数据档案，再提交毕业；高风险 guard 回复出现时，H5 显示独立的现实支持提示和热线拨号入口；状态徽标不再向用户兜底显示内部状态名，并补 H5 静态回归测试；本地 h5 targeted tests、typecheck、全量 tests、build:demo、git diff --check 通过
2026-07-07 Step 2.38: H5 onboarding consent UX 已实现并推送；创建记忆伙伴前需要确认“辅助性记忆对话、不替代身边的人或专业帮助、可随时导出/删除自己的数据”，`POST /api/me/persona` 同步要求 `consentAccepted: true`，新建另一位时会重置确认；新增 H5/API 静态回归测试；本地 targeted tests、typecheck、211 tests + 2 skipped、build:demo、git diff --check 通过；最新已推送提交 `59e8119 feat: add h5 onboarding consent gate`
2026-07-07 Step 2.39: H5 account deletion inline confirmation 已实现并推送；“删除全部数据”改为页面内确认面板，说明删除不可恢复、建议先导出数据档案，并要求输入“删除”后再提交既有 `/api/me/delete`；新增 H5 静态回归测试；本地 `npm test -- h5-experience`、typecheck、212 tests + 2 skipped、build:demo、git diff --check 通过；最新已推送提交 `871c4d0 feat: add h5 delete confirmation`
2026-07-07 Step 2.40: H5 memory append UX/API 已实现并推送；新增 `/api/me/memory` 并通过当前登录用户 + persona scoped runtime 写入补充记忆；H5 对话区新增“补充记忆”面板，文案限定为已经发生过的细节；runtime HTTP smoke 覆盖该接口；与 Step 2.41 合并推送为 `adac0ea feat: add h5 memory append and graduation confirmation`
2026-07-07 Step 2.41: H5 graduation inline confirmation 已实现并推送；毕业改为页面内确认，输入“告别”后才执行；毕业仍先导出数据档案再提交 `/api/me/graduate`；与 Step 2.40 合并推送为 `adac0ea feat: add h5 memory append and graduation confirmation`
2026-07-08 Step 2.42: scoped runtime daily usage persistence 已实现并推送；H5 `/api/me/chat` 的 scoped runtime guard 在每日限额检查通过后会显式写回 `dailyMessageCount` / `lastMessageDate`，Postgres scoped mode 下不再只更新内存对象；更新不改变 Covenant state、snapshot 或 NODE context；与 Step 2.43 合并推送为 `e4a14dd feat: persist runtime usage and add seal confirmation`
2026-07-08 Step 2.43: H5 seal inline confirmation 已实现并推送；ACTIVE 状态下“封存”先打开页面内确认面板，用户输入“安放”后才提交 `/api/me/seal`；切换/新建 persona 和封存成功会收起确认面板；与 Step 2.42 合并推送为 `e4a14dd feat: persist runtime usage and add seal confirmation`
2026-07-08 Step 2.44: H5 node complete inline confirmation 已实现并推送；NODE 状态下“完成这个时刻”先打开页面内确认面板，用户输入“收束”后才提交 `/api/me/complete-node`；离开 NODE、切换/新建 persona 和完成成功会收起确认面板；与 Step 2.45 合并推送为 `12c0548 feat: add h5 node completion and activation safeguards`
2026-07-08 Step 2.45: H5 node activation inline status 已实现并推送；SEALED 状态开启特别时刻必须填写具体名称，不再空值兜底“重要时刻”；Covenant 操作失败从浏览器 alert 改为页面内状态提示；与 Step 2.44 合并推送为 `12c0548 feat: add h5 node completion and activation safeguards`
2026-07-08 Step 2.46: H5 panel mutual exclusion 已实现并推送；补充记忆、封存确认、节点完成确认、毕业确认之间会自动互斥收起，避免同一屏堆叠多个关键动作；推送为 `f21b392 fix: keep h5 lifecycle panels mutually exclusive`
2026-07-08 Step 2.47: H5 visible mechanism leak guard 已实现并推送；H5 静态测试会剥离 script/style/comment 后扫描用户可见正文与常见可见属性，防止 SoulVersion、scope、Covenant raw state、后台审核、AI模型等机制词进入前台文案；同时把安全/付费文案改成用户能理解的现实支持与数据档案表达；推送为 `0d78c32 test: guard h5 visible copy against mechanism leaks`
2026-07-08 Step 2.48: H5 runtime safe error guard 已实现并推送；H5 状态栏与聊天气泡展示错误前统一走 `h5SafeErrorMessage()`，遇到 personaId、Covenant、raw lifecycle state、当前状态不允许、节点重启等机制词时回退为用户语言；Covenant 操作不再直接展示 `data.error`；与 Step 2.49 合并推送为 `ca296ca fix: sanitize h5 runtime errors and soften copy`
2026-07-08 Step 2.49: H5 user-facing copy softening 已实现并推送；前台可见文案把“节点重启 / AI人格 / 毕业机制”等机制化表达改为“特别时刻 / 记忆伙伴 / 主动告别”，并把这些词加入 H5 visible mechanism leak guard；与 Step 2.48 合并推送为 `ca296ca fix: sanitize h5 runtime errors and soften copy`
2026-07-08 Step 2.50: H5 runtime unsafe fragment parity 已实现并推送；`H5_UNSAFE_ERROR_FRAGMENTS` 补齐后台通知、人工审核、极端情绪词汇、AI模型、AI人格、基础AI人格、毕业机制等词，使运行时错误过滤与可见文案护栏保持一致；推送为 `4663ce5 test: align h5 runtime error mechanism guard`
2026-07-08 Step 2.51: H5 load conversation safe error handling 已实现并推送；`h5LoadConversation()` 读取对话失败时捕获异常并通过 `h5SafeErrorMessage(error, '读取对话失败，请稍后再试。')` 在页面状态区展示用户语言，避免 persona 切换或 Covenant 后刷新历史时泄露 raw backend error；推送为 `58c0fe5 fix: handle h5 conversation load errors safely`
2026-07-08 Step 2.52: H5 persona switcher safe rendering 已实现并推送；`h5UpdatePersonaList()` 不再用 `innerHTML` 拼接用户输入的 displayName/relationship，而是通过 `document.createElement('option')`、`option.value` 和 `option.textContent` 渲染下拉项，降低用户输入标签注入风险；推送为 `0e9ffee fix: render h5 persona switcher safely`
2026-07-09 Step 2.53: H5 request non-JSON safe fallback 已实现并推送；`h5Request()` 不再直接 `response.json()`，而是读取 `response.text()` 后安全 `JSON.parse`，遇到非 JSON / 空响应时使用固定“请求失败。”错误，避免网关或静态错误页解析异常进入用户可见错误；推送为 `9619fb9 fix: handle h5 non-json responses safely`
2026-07-09 Step 2.54: H5 guest mode unified request handling 已实现并推送；`h5GuestMode()` 不再手写 `fetch('/api/register')` / `res.json()`，改为复用 `h5Request('/api/register', { skipAuth: true })`，使体验模式注册同样获得非 JSON 响应兜底与 `h5SafeErrorMessage()` 机制词过滤；推送为 `4de0af0 fix: unify h5 guest mode request handling`
2026-07-09 Step 2.55: H5 Covenant unified request handling 已实现并推送；`h5RefreshCovenantState()` 和 `h5CovenantAction()` 不再手写 fetch/res.json，统一复用 `h5Request()`，使封存、开启特别时刻、完成特别时刻和状态刷新同样获得非 JSON 响应兜底与 `h5SafeErrorMessage()` 机制词过滤；推送为 `e251fd3 fix: unify h5 covenant request handling`
2026-07-09 Step 2.56: H5 request string error guard 已实现并推送；`h5Request()` 仅允许非空字符串 `data.error` 进入 `Error`，对象、数组、空值等异常 error payload 统一回退为“请求失败。”，避免 `[object Object]` 或非用户语言进入 H5 可见错误；本地 h5 targeted test、typecheck、225 tests + 2 skipped、build:demo 通过；推送为 `909783d fix: guard h5 request error payloads`
2026-07-09 Step 2.56 文档收口已推送；交接文档、roadmap 和 README 已把 Step 2.56 从“待 push”纠偏为“已推送”，避免后续进程继续卡在旧状态；推送为 `63de393 docs: mark step 2.56 as pushed`
2026-07-09 Step 2.57: H5 conversation DOM rendering 已实现并推送；`h5RenderConversation()` / `h5AppendBubble()` 不再用 HTML 字符串拼接聊天气泡，改为 `h5CreateBubble()` + DOM `textContent` 渲染用户输入和助手回复，降低 H5 对话区用户内容注入风险；本地 h5 targeted test、typecheck、226 tests + 2 skipped、build:demo、git diff --check 通过；推送为 `3e7861e fix: render h5 conversation bubbles with DOM text APIs`
2026-07-09 Step 2.58: marketing chat DOM rendering 已实现并推送；官网首页在线咨询模拟聊天不再用 `innerHTML` 拼接用户输入和模拟回复，改为 `createMarketingChatBubble()` + DOM `textContent` 渲染，并删除不再需要的 `escapeHtml()` helper；本地 h5 targeted test、typecheck、227 tests + 2 skipped、build:demo 通过；推送为 `c97c715 fix: render marketing chat with DOM text APIs`
2026-07-10 Step 2.59: H5 onboarding choices DOM rendering 已实现并推送；`h5InitQuickNames()` / `h5InitTraits()` 不再用 HTML 字符串拼接常用称呼和性格特征选项，改为 DOM `textContent` 与 `addEventListener()` 渲染和绑定，降低 H5 创建流程可见选项未来被拼入 HTML 的风险；本地 h5 targeted test、typecheck、228 tests + 2 skipped、build:demo 通过；推送为 `a1a66ec fix: render h5 onboarding choices with DOM text APIs`
2026-07-10 Step 2.60: H5 Covenant actions DOM rendering 已实现并推送；`h5RefreshCovenantState()` 不再用 `actions.innerHTML` 和 inline `onclick` 拼接封存、开启特别时刻、毕业、完成特别时刻控件，改为 `h5CreateCovenantButton()` / `h5CreateNodeNameInput()` + DOM `textContent` 与 `addEventListener()`；本地 h5 targeted test、typecheck、229 tests + 2 skipped、build:demo 通过；推送为 `cf1f5d9 fix: render h5 covenant actions with DOM text APIs`
2026-07-10 Step 2.61: H5 loading bubble DOM rendering 已实现并推送；`h5AppendLoading()` 不再用 `insertAdjacentHTML` 拼接“正在回复……”等待气泡，改为 `h5CreateLoadingBubble()` + DOM `textContent` 渲染，降低 H5 对话等待状态未来被 HTML 字符串扩展时的注入风险；本地 h5 targeted test、typecheck、230 tests + 2 skipped、build:demo 通过；推送为 `4e00c24 fix: render h5 loading bubble with DOM text APIs`
2026-07-10 Step 2.62: H5/public inline event handler binding 已实现并推送；`public/index.html` 用户前台不再保留 inline `onclick` / `onchange` / `oninput` / `onkeydown`，H5 体验弹窗、官网咨询聊天、付费流程弹窗统一改为 `data-action` / `data-role` / `data-plan` + `bindPublicInteractionHandlers()` 事件绑定；本地 h5 targeted test、typecheck、231 tests + 2 skipped、build:demo、demo server 首页 smoke 通过；推送为 `18641cd fix: bind public page interactions without inline handlers`
2026-07-10 Step 2.63: public pricing CTA flow binding 已实现并推送；定价区三张方案卡片不再跳到在线咨询区 `#cta`，改为通过 `data-action="open-flow"` 打开付费流程弹窗并预选对应 light/standard/lifetime 方案，`openFlow()` 支持指定方案和初始步骤；本地 h5 targeted test、typecheck、231 tests + 2 skipped、build:demo、构建产物静态扫描通过；推送为 `8c12c99 fix: connect pricing CTAs to payment flow`
2026-07-10 Step 2.64: public pricing dependency-safe copy 已实现并推送；公开页定价与付费流程文案移除“终身访问 / 永久使用 / 无限轮次 / AI复刻 / 记忆人格”等容易制造依赖或机制感的表达，改为“纪念托管 / 长期保存 / 更高对话额度 / 记忆伙伴资料”等用户语言，并把这些词加入 H5 可见文案和运行时错误过滤护栏；本地 h5 targeted test、typecheck、231 tests + 2 skipped、build:demo 通过；推送为 `92440b0 fix: soften public pricing dependency copy`
2026-07-10 Step 2.65: public footer compliance links 已实现并推送；公开页页脚“用户协议 / 隐私政策 / 伦理承诺”不再是 `href="#"` 空链接，新增同页 `#terms` / `#privacy` / `#ethics` 合规摘要区，强调暂停、导出、删除数据和不以高频使用奖励推动停留；H5 静态测试新增空链接和 hash target 完整性防回归；本地 h5 targeted test、typecheck、232 tests + 2 skipped、build:demo、git diff --check 通过；推送为 `d68a15c fix: link public footer compliance sections`
2026-07-10 Step 2.65 文档收口已推送；CURRENT-STATE、roadmap、README 和 handoff 已记录 Step 2.65 pushed 状态与“后续只提供 Summary、不提供 Description:”协作约定；推送为 `e5810ff docs: mark step 2.65 as pushed`
2026-07-10 Step 2.66: release env-file inputs 本地已实现；`release:preflight` 支持 `--env-file <path>`，`release:validation-suite` 支持 `--env-file <path>`、`--from-json-env <env-key>`、`--from-sqlite-env <env-key>`，可安全读取被 `.gitignore` 忽略的 `.env.release` 并从 env key 解析 snapshot/SQLite 输入路径；shell env 非空值优先，输出不打印 env 文件路径、snapshot 路径、DB URL、token 或 raw 子命令输出；当前 `.env` 实测仍 blocked：`NNZ_DB_PATH` 文件不存在且 release DB/tokens 缺失；本地 targeted tests、typecheck、234 tests + 2 skipped、build:demo、git diff --check 通过，尚待下一次合并 push
```

当前代码基线相对远端：

```text
main...origin/main @ e5810ff docs: mark step 2.65 as pushed
当前本地新增 Step 2.66 release env-file inputs changes pending
```

最新已推送提交：

```text
e5810ff docs: mark step 2.65 as pushed
```

协作约定：

```text
后续需要用户通过 GitHub Desktop / 终端 push 时，只提供 Summary，不再提供 Description:。
每个版本变更或发版记录由 Codex 同步写入对应 Step 文档、CURRENT-STATE、roadmap、README / handoff，方便后续查阅。
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
nnz-mvp-2026-06-23-H5修复上线验收记录.md
nnz-mvp-2026-06-23-Step2.5-PostgresScopedRepository计划.md
nnz-mvp-2026-06-24-Step2.6-PostgresScopedCovenant计划.md
nnz-mvp-2026-06-24-Step2.7-PostgresScoped剩余表计划.md
nnz-mvp-2026-06-25-Step2.8-PostgresIntegration测试计划.md
nnz-mvp-2026-06-25-Step2.9-SnapshotToScopedTables迁移预检.md
nnz-mvp-2026-06-26-Step2.10-SnapshotDryRunCLI.md
nnz-mvp-2026-06-26-Step2.11-ScopedMigrationRows.md
nnz-mvp-2026-06-26-Step2.12-ScopedMigrationExecutor.md
nnz-mvp-2026-06-26-Step2.13-ExecutorIntegrationHarness.md
nnz-mvp-2026-06-26-Step2.14-ExecutorClientTransaction.md
nnz-mvp-2026-06-29-Step2.15-StoreSnapshotExportCLI.md
nnz-mvp-2026-06-30-Step2.16-SanitizedMigrationSummary.md
nnz-mvp-2026-07-01-Step2-MigrationReadinessRoadmap.md
nnz-mvp-2026-07-01-Step2.17-ProtectedMigrationExecuteCLI.md
nnz-mvp-2026-07-01-Step2.18-MigrationReadinessCLI.md
nnz-mvp-2026-07-01-Step2.19-DisposableMigrationSmokeCLI.md
nnz-mvp-2026-07-01-Step2.20-RuntimePersistenceModeGuardrail.md
nnz-mvp-2026-07-02-Step2.21-MigrationGuardrailHardening.md
nnz-mvp-2026-07-03-Step2.22-ScopedRuntimeAdapterFoundation.md
nnz-mvp-2026-07-03-Step2.23-ApiMeScopedRuntimeAdapter.md
nnz-mvp-2026-07-03-Step2.24-GuardedScopedRuntimePostgresMode.md
nnz-mvp-2026-07-03-Step2.25-ScopedRuntimeSmokeGuard.md
nnz-mvp-2026-07-03-Step2.26-ScopedOpsCleanupAudit.md
nnz-mvp-2026-07-06-Step2.27-ScopedOpsOverview.md
nnz-mvp-2026-07-06-Step2.28-UserDataExportDelete.md
nnz-mvp-2026-07-06-Step2.29-ScopedRuntimeHttpSmoke.md
nnz-mvp-2026-07-06-Step2.30-ScopedRuntimeSmokeSuite.md
nnz-mvp-2026-07-06-Step2.31-MigrationValidationSuite.md
nnz-mvp-2026-07-06-Step2.32-OpsRoleTokenSmoke.md
nnz-mvp-2026-07-07-Step2.33-ReleasePreflight.md
nnz-mvp-2026-07-07-Step2.34-ReleaseValidationSuite.md
nnz-mvp-2026-07-07-Step2.35-ReleaseEvidence.md
nnz-mvp-2026-07-07-Step2.36-SensitiveArtifactIgnore.md
nnz-mvp-2026-07-07-Step2.37-H5GraduationExport.md
nnz-mvp-2026-07-07-Step2.38-H5OnboardingConsent.md
nnz-mvp-2026-07-07-Step2.39-H5DeleteInlineConfirm.md
nnz-mvp-2026-07-07-Step2.40-H5MemoryAppend.md
nnz-mvp-2026-07-07-Step2.41-H5GraduationInlineConfirm.md
nnz-mvp-2026-07-08-Step2.42-ScopedRuntimeDailyUsage.md
nnz-mvp-2026-07-08-Step2.43-H5SealInlineConfirm.md
nnz-mvp-2026-07-08-Step2.44-H5NodeCompleteInlineConfirm.md
nnz-mvp-2026-07-08-Step2.45-H5NodeActivationInlineStatus.md
nnz-mvp-2026-07-08-Step2.46-H5PanelMutualExclusion.md
nnz-mvp-2026-07-08-Step2.47-H5VisibleMechanismLeakGuard.md
nnz-mvp-2026-07-08-Step2.48-H5RuntimeSafeErrorGuard.md
nnz-mvp-2026-07-08-Step2.49-H5UserFacingCopySoftening.md
nnz-mvp-2026-07-08-Step2.50-H5RuntimeUnsafeFragmentParity.md
nnz-mvp-2026-07-08-Step2.51-H5LoadConversationSafeError.md
nnz-mvp-2026-07-08-Step2.52-H5PersonaSwitcherSafeRendering.md
nnz-mvp-2026-07-09-Step2.53-H5RequestNonJsonSafeFallback.md
nnz-mvp-2026-07-09-Step2.54-H5GuestModeUnifiedRequest.md
nnz-mvp-2026-07-09-Step2.55-H5CovenantUnifiedRequest.md
nnz-mvp-2026-07-09-Step2.56-H5RequestStringErrorGuard.md
nnz-mvp-2026-07-09-Step2.57-H5ConversationDomRendering.md
nnz-mvp-2026-07-09-Step2.58-MarketingChatDomRendering.md
nnz-mvp-2026-07-10-Step2.59-H5OnboardingChoicesDomRendering.md
nnz-mvp-2026-07-10-Step2.60-H5CovenantActionsDomRendering.md
nnz-mvp-2026-07-10-Step2.61-H5LoadingBubbleDomRendering.md
nnz-mvp-2026-07-10-Step2.62-H5PublicEventHandlerBinding.md
nnz-mvp-2026-07-10-Step2.63-PublicPricingCtaFlowBinding.md
nnz-mvp-2026-07-10-Step2.64-PublicPricingDependencySafeCopy.md
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
│   ├── postgres-scoped-soul-repository.ts — Postgres 逐表 scoped repository 最小旁路切片
│   ├── persistence.ts    — SQLite save/load for demo persistence
│   ├── soul-scope.test.ts
│   ├── scoped-soul-repository.test.ts
│   ├── postgres-scoped-soul-repository.test.ts
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
| `postgres-scoped-soul-repository.ts` | ~700 行 | Postgres scoped repository 旁路切片 | ensurePostgresScopedSchema, createPostgresScopedSoulRepositoryFromPool, createSoulVersion, sealSoul, activateNode |
| `scoped-runtime-adapter.ts` | ~220 行 | demo runtime 切换前的双后端适配层 | createInMemoryScopedRuntimeAdapter, createPostgresScopedRuntimeAdapter, getRuntimeContext |
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

### 已完成：Step 2.5 / 2.6 Postgres scoped repository 旁路切片

2026-06-23 已新增 `PostgresScopedSoulRepository`，用于把当前 Postgres snapshot persistence 逐步演进到强作用域逐表 repository。

当前包含：

- `nnz_users`
- `nnz_personas`
- `nnz_memory_items`
- `nnz_conversation_messages`
- `nnz_soul_versions`
- `nnz_soul_snapshots`
- `nnz_node_events`
- `nnz_runtime_sessions`
- `nnz_soul_update_proposals`
- `nnz_credentials`
- `nnz_ops_audit_events`

边界：

- repository 构造时必须绑定完整 `{ userId, personaId }`。
- memory / conversation 写入前会确认 persona 属于该 user。
- memory / conversation 查询必须同时带 `user_id` 和 `persona_id`。
- `nnz_memory_items` / `nnz_conversation_messages` 通过 `(user_id, persona_id)` 复合外键指向 `nnz_personas(user_id, id)`。
- 创建新 ACTIVE SoulVersion 只归档当前 scope 的旧 ACTIVE。
- Seal / Node / Complete / Graduate 只改变当前绑定 scope。
- `addConversation({ nodeId })` 会拒绝引用其他 scope 的 node。
- Proposal evidence 必须来自同 scope 且允许 Soul Update 的 memory。
- Credential 按 user 绑定；OpsAudit 作为后台对象逐表记录。
- 这是旁路最小切片，尚未替换 demo runtime 的 `nnz_store_snapshots` JSONB persistence。

本地验证：

```text
npm run typecheck
npm test         # 13 files, 87 tests passed; 1 integration file skipped by default
npm run build:demo
```

下一步：Step 2 migration readiness 还剩 4 个未完成目标。优先用真实本地 snapshot 样本和一次性测试库运行 `migration:validation-suite`，生成 raw snapshot、sanitized report、sanitized summary，并在 readiness 干净后跑 disposable Postgres migration smoke；Render 侧再验证可选角色 token（viewer/operator/admin）；最后用 disposable `NNZ_POSTGRES_SCOPED_RUNTIME_URL` 运行 `runtime:smoke-suite`，一次覆盖 scoped runtime adapter 与真实 `/api/me/*` HTTP 的注册、创建、聊天、Covenant、导出和删除。token/连接串明文不得写入仓库或文档。

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

当前修复已推送并通过 GitHub Actions / Render smoke。2026-06-10 已实现并云端验证首页 H5 真实用户私有 Soul 验证入口；2026-06-11 已完成 Render Postgres 接入和重启后持久化 smoke；同日 Step 1 已完成后台测试数据清理和独立 `/ops` Soul Ops 后台雏形。2026-06-16 已完成 Render `NNZ_OPS_TOKEN` 配置和云端 `/ops` smoke，并完成 Step 2.1 Soul Ops 审计日志。2026-06-17 已完成 Step 2.2 Soul Ops RBAC 与删除回执；同日 Step 2.3 已完成 Audit 查询接口和 `/ops` Audit tab，并已推送通过 GitHub Actions / Render 基础 smoke。2026-06-23 已完成 Step 2.5 Postgres scoped repository 最小旁路切片。2026-06-24 已完成 Step 2.6 Postgres scoped Covenant 主链旁路切片；同日 Step 2.7 已补齐 Proposal/Credential/OpsAudit 旁路表。2026-06-25 已新增 opt-in 真实 Postgres integration test harness，并完成 snapshot -> scoped tables 离线迁移预检 planner。2026-06-26 已补本地 dry-run CLI、scoped migration row builder、executor core 和 executor disposable DB integration harness。2026-06-29 已补 StoreSnapshot export CLI。2026-06-30 已补 migration dry-run sanitized summary。2026-07-01 已整理 migration readiness roadmap，并已补 protected migration execution CLI、migration readiness CLI、disposable migration smoke CLI 和 runtime persistence mode guardrail。2026-07-02 已按产品进程审计修补 migration guardrails。2026-07-03 已补 scoped runtime adapter foundation、`/api/me/*` InMemory adapter wiring、guarded scoped runtime Postgres mode、scoped runtime smoke guard、scoped Ops cleanup/audit cutover slice；2026-07-06 已补 scoped Ops overview aggregation、user data export/delete cutover、scoped runtime HTTP smoke CLI、scoped runtime smoke suite 和 migration validation suite；当前剩余 4 个目标未完全收口：真实 snapshot readiness、一次性 Postgres smoke、云端角色 token smoke、真实 scoped Postgres runtime smoke 实跑。
