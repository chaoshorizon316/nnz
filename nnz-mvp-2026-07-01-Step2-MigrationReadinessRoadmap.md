# nnz-mvp 2026-07-01 Step 2 Migration Readiness Roadmap

## 当前结论

Step 2 的 scoped repository、snapshot migration 工具链和当前前台发布收口已经完成到 Step 2.65。最新已推送提交是：

```text
d68a15c fix: link public footer compliance sections
```

Step 2.56 H5 request string error guard 已完成验证并推送，Step 2.57 H5 conversation DOM rendering 已完成验证并推送，Step 2.58 marketing chat DOM rendering 已完成验证并推送，Step 2.59 H5 onboarding choices DOM rendering 已完成验证并推送，Step 2.60 H5 Covenant actions DOM rendering 已完成验证并推送，Step 2.61 H5 loading bubble DOM rendering 已完成验证并推送，Step 2.62 H5/public inline event handler binding 已完成验证并推送，Step 2.63 public pricing CTA flow binding 已完成验证并推送，Step 2.64 public pricing dependency-safe copy 已完成验证并推送，Step 2.65 public footer compliance links 已完成验证并推送；它们都不改变本路线图的外部 release validation 剩余入口。后续不要再卡在“等待推送 Step 2.56 / Step 2.60 / Step 2.61 / Step 2.62 / Step 2.63 / Step 2.64 / Step 2.65”，当前唯一上线闸口仍是外部输入齐备后的 `release:validation-suite`。

截至 2026-07-10，链路还剩 **1 个总外部实跑入口未执行**：`release:validation-suite`。它会串行运行真实本地 snapshot + 一次性 Postgres 的 `migration:validation-suite`、Render viewer/operator/admin 角色 token 的 `ops:role-smoke`、以及真实 scoped runtime DB 的 `runtime:smoke-suite`。受保护执行入口、readiness/smoke CLI、migration validation suite、runtime mode guardrail、migration guardrail hardening、scoped runtime adapter foundation、`/api/me/*` 用户端 InMemory adapter wiring、guarded scoped runtime Postgres adapter mode、scoped runtime smoke guard、scoped Ops cleanup/audit cutover、scoped Ops overview aggregation、用户 export/delete cutover、scoped runtime HTTP smoke CLI、合并执行的 scoped runtime smoke suite、Ops role token smoke CLI、release preflight CLI、release validation suite CLI、本地可选 release evidence JSON、敏感本地产物 ignore guard、以及本地 `.env.example` 都已完成实现；真实 DB/Render 执行仍需要 disposable URL、snapshot 路径或 token env。

## 已完成基线

- Step 2.5-2.7：`PostgresScopedSoulRepository` 已覆盖 users/personas/memory/conversations/soul versions/snapshots/nodes/runtime sessions/proposals/credentials/ops audit。
- Step 2.8：真实 Postgres repository integration harness 已实现，默认 skip，只读取 `NNZ_POSTGRES_INTEGRATION_URL`。
- Step 2.9：snapshot -> scoped tables 离线迁移预检 planner 已实现。
- Step 2.10：`migration:plan` CLI 已实现，支持 `--json` 与 sanitized `--report`。
- Step 2.11：scoped migration row builder 已实现。
- Step 2.12：write-side migration executor core 已实现，需要显式 confirm。
- Step 2.13：executor disposable DB integration harness 已实现，默认 skip。
- Step 2.14：executor 已改为 checked-out client transaction，避免 `pg.Pool#query()` 多连接事务漂移。
- Step 2.15：`snapshot:export` CLI 已实现，只读取显式本地 JSON/SQLite 输入，stdout 只输出 counts。
- Step 2.16：`migration:plan -- --summary` 已实现，只输出聚合 counts/code/table/nextAction。
- Step 2.17：`migration:execute` protected CLI 已实现；默认 dry-run，执行模式只读取 `NNZ_POSTGRES_INTEGRATION_URL`，拒绝 `DATABASE_URL` / `NNZ_POSTGRES_URL`，需要显式 confirm。
- Step 2.18：`migration:readiness` CLI 已实现；从显式本地 JSON/SQLite 一次生成 raw snapshot、sanitized report、sanitized summary，不读取任何 DB env。
- Step 2.19：`migration:smoke` CLI 已实现；用 disposable DB 验证 executor 幂等、repository 读回、scope 隔离、cascade delete 和 fixture cleanup。
- Step 2.20：runtime persistence mode guardrail 已实现；`NNZ_RUNTIME_PERSISTENCE_MODE=snapshot` 保持默认 snapshot 路径，`scoped` 模式需要 `NNZ_POSTGRES_SCOPED_RUNTIME_URL` 且在 adapter 完成前 fail-fast；`/healthz` 和 Ops overview 只暴露 env key / boolean 诊断。
- Step 2.21：migration guardrail hardening 已实现；`migration:execute` 与 `migration:smoke` 会拒绝 `NNZ_POSTGRES_INTEGRATION_URL` 与 `DATABASE_URL` / `NNZ_POSTGRES_URL` 值相同的生产别名误配，并对 pool close failure 使用固定脱敏输出。
- Step 2.22：scoped runtime adapter foundation 已实现；新增 `ScopedRuntimeAdapter`，同时支持 InMemory 与 Postgres scoped repository 后端，覆盖 auth credential、persona、conversation、runtime context、Covenant NODE/SEALED/GRADUATED 的切换接口。
- Step 2.23：`/api/me/*` 用户端 auth/persona/chat/Covenant flow 已接入 InMemory `ScopedRuntimeAdapter`；默认 snapshot/Postgres JSONB 持久化语义不变，并通过本地 API smoke 验证注册、创建、聊天、历史、封存、节点重启和完成节点。
- Step 2.24：`NNZ_RUNTIME_PERSISTENCE_MODE=scoped` 已接到 Postgres scoped runtime persistence helper；启动时只读取 `NNZ_POSTGRES_SCOPED_RUNTIME_URL`、确保 scoped schema、把 `/api/me/*` runtime adapter 指向 Postgres scoped tables；缺专用 URL 仍 fail-fast，默认 snapshot 路径不变。
- Step 2.25：`NNZ_POSTGRES_SCOPED_RUNTIME_URL` 已加生产别名误配防护；新增 `runtime:smoke`，只允许专用 scoped runtime URL + 显式 confirm，并用 scoped runtime adapter 验证 credential/persona/runtime context/Covenant/cross-scope/cascade/cleanup，输出全脱敏。
- Step 2.26：scoped mode 下 Ops cleanup/audit 第一段已切到 scoped Postgres；`/api/ops/cleanup-test-users` dry-run/confirm 与 audit write/query 可走 `nnz_*` scoped tables；full Ops overview user/persona maturity 与用户 export/delete 仍待后续。
- Step 2.27：scoped mode 下 `/api/ops/overview` users/personas/maturity aggregation 已切到 scoped Postgres；后台内部复用现有 maturity 算法，不返回 memory/chat/hash 正文。
- Step 2.28：用户数据 export/delete 已接入 `ScopedRuntimeAdapter`；`GET /api/me/export` 导出当前登录用户自己的完整数据档案但不含 credential hash 或后台 OpsAudit，`POST /api/me/delete` 需要 `DELETE_MY_DATA` 确认并只删除当前登录用户；scoped Postgres mode 下通过 `nnz_users` FK cascade 清理 scoped tables。
- Step 2.29：`runtime:http-smoke` CLI 已实现；用 disposable `NNZ_POSTGRES_SCOPED_RUNTIME_URL` 启动真实 `dist-cjs/demo-server.js` scoped mode，清空 child `NNZ_LLM_*`，验证 `/healthz` scoped 诊断以及 `/api/me/*` register/persona/chat/history/Covenant/export/delete HTTP 链路；拒绝 `DATABASE_URL` / `NNZ_POSTGRES_URL` 与生产别名同值，输出脱敏。
- Step 2.30：`runtime:smoke-suite` CLI 已实现；一次运行 direct `runtime:smoke`、`build:demo`、HTTP `runtime:http-smoke`，统一使用 `NNZ_POSTGRES_SCOPED_RUNTIME_URL` 与 suite confirm，失败时只输出固定 stage 与脱敏说明。
- Step 2.31：`migration:validation-suite` CLI 已实现；一次运行 offline `migration:readiness` 与 disposable `migration:smoke`，readiness 干净后才连接 `NNZ_POSTGRES_INTEGRATION_URL`，失败时不输出 raw snapshot、child command output 或 raw details。
- Step 2.32：`ops:role-smoke` CLI 已实现；默认非破坏性地验证 missing/invalid token、viewer read-only、operator dry-run、admin dry-run 与 admin delete confirmation boundary，确认删除 smoke 需要额外 `--include-delete --delete-confirm RUN_OPS_ROLE_TOKEN_DELETE_SMOKE`。
- Step 2.33：`release:preflight` CLI 已实现；不读取 snapshot 内容、不连接数据库、不触网，只检查 snapshot/SQLite 输入、disposable DB env、role token env、scoped runtime DB env 是否具备，并输出脱敏状态。
- Step 2.34：`release:validation-suite` CLI 已实现；要求 `RUN_NNZ_RELEASE_VALIDATION_SUITE`，先跑 preflight，再串 `migration:validation-suite`、默认非破坏性 `ops:role-smoke`、`runtime:smoke-suite`，失败时不拼接子命令 raw output。
- Step 2.35：`release:validation-suite -- --evidence-out <path>` 已实现并推送；确认执行后成功或 stage 失败都会写脱敏 evidence JSON，只记录 stage 状态、env key 名和本地产物类别，不记录 snapshot 路径、DB URL、token、用户内容、child output、server log 或 raw error details。
- Step 2.36：sensitive local release safety 已实现并推送；`.gitignore` 显式忽略 SQLite/DB、raw/report/summary/evidence JSON、migration/release/snapshot artifact 目录；`nnz-mvp/.env.example` 提供空 env key 和 disposable DB 安全注释，降低真实 snapshot/readiness/evidence 产物误提交和外部实跑误配置风险。
- Step 2.37：H5 graduation export + safety support UX 已实现并推送；毕业前先导出用户数据档案，高风险回复显示现实支持提示和热线入口，状态文案不暴露内部 lifecycle state。
- Step 2.38：H5/API onboarding consent UX 已实现并推送；创建记忆伙伴前需要确认使用边界和数据权利，`POST /api/me/persona` 同步要求 `consentAccepted: true`。
- Step 2.39：H5 account deletion inline confirmation 已实现并推送；删除全部数据改为页面内确认、建议先导出、输入“删除”后二次确认，仍走既有 scoped `/api/me/delete`。
- Step 2.40：H5 memory append UX/API 已实现并推送；用户可为当前选中的记忆伙伴补充一段已经发生过的细节，API 通过当前登录用户 + persona 的 scoped runtime 写入，不新增 migration。
- Step 2.41：H5 graduation inline confirmation 已实现并推送；毕业改为页面内确认，输入“告别”后才执行，仍保持先导出数据档案再提交毕业。
- Step 2.42：scoped runtime daily usage persistence 已实现并推送；H5 scoped runtime 聊天 guard 在每日限额检查通过后显式写回 `dailyMessageCount` / `lastMessageDate`，Postgres scoped mode 下不再只更新 session 副本，且保留 Covenant/NODE 上下文。
- Step 2.43：H5 seal inline confirmation 已实现并推送；首次封存从一键执行改为页面内确认，输入“安放”后才提交 `/api/me/seal`，补齐 Seal / Node / Graduation 用户旅程中的封存确认。
- Step 2.44：H5 node complete inline confirmation 已实现并推送；NODE 阶段完成特别时刻从一键执行改为页面内确认，输入“收束”后才提交 `/api/me/complete-node`。
- Step 2.45：H5 node activation inline status 已实现并推送；开启特别时刻必须填写具体名称，Covenant 操作错误改为页面内状态提示，不再使用浏览器弹窗。
- Step 2.46：H5 panel mutual exclusion 已实现并推送；补充记忆、封存确认、节点完成确认、毕业确认之间会自动互斥收起，避免同一屏堆叠多个关键动作。
- Step 2.47：H5 visible mechanism leak guard 已实现并推送；H5 静态测试扫描用户可见正文和常见可见属性，防止内部机制词、后台审核表达和模型表达进入前台文案，并把安全/付费卡片改成现实支持与数据档案语言。
- Step 2.48：H5 runtime safe error guard 已实现并推送；H5 运行时错误展示统一先过滤内部机制词，Covenant 操作、毕业、登录、导出、删除、创建、补充记忆和发送消息不再直接向用户暴露 raw backend error。
- Step 2.49：H5 user-facing copy softening 已实现并推送；前台可见文案把“节点重启 / AI人格 / 毕业机制”等机制化表达改为“特别时刻 / 记忆伙伴 / 主动告别”，并把这些词加入 visible mechanism leak guard。
- Step 2.50：H5 runtime unsafe fragment parity 已实现并推送；运行时错误过滤词表补齐到覆盖新增可见文案禁用词，避免后端错误里出现模型/审核/AI人格等表达时漏过滤。
- Step 2.51：H5 load conversation safe error handling 已实现并推送；`h5LoadConversation()` 读取对话失败时捕获异常并统一走 `h5SafeErrorMessage()`，避免 persona 切换或 Covenant 后刷新历史时显示 raw backend error。
- Step 2.52：H5 persona switcher safe rendering 已实现并推送；persona 下拉框不再用 `innerHTML` 拼接用户输入的 displayName/relationship，改用 DOM option + `textContent`，降低用户输入标签注入风险。
- Step 2.53：H5 request non-JSON safe fallback 已实现并推送；`h5Request()` 不再直接 `response.json()`，非 JSON / 空响应会收敛为固定用户语言错误，避免解析异常进入用户可见错误。
- Step 2.54：H5 guest mode unified request handling 已实现并推送；体验模式注册复用 `h5Request('/api/register', { skipAuth: true })`，不再手写 fetch/JSON parse，统一获得请求层非 JSON 兜底和运行时错误过滤。
- Step 2.55：H5 Covenant unified request handling 已实现并推送；Covenant 状态刷新和封存/开启/完成动作复用 `h5Request()`，不再手写 fetch/JSON parse，统一获得请求层非 JSON 兜底和运行时错误过滤。
- Step 2.56：H5 request string error guard 已实现并推送；`h5Request()` 仅允许非空字符串 `data.error` 进入 `Error`，对象、数组、空值等异常 error payload 统一回退为“请求失败。”。
- Step 2.57：H5 conversation DOM rendering 已实现并推送；H5 对话气泡从 HTML 字符串拼接改为 DOM `textContent` 渲染用户输入和助手回复，降低对话区用户内容注入风险。
- Step 2.58：Marketing chat DOM rendering 已实现并推送；官网首页在线咨询模拟聊天从 `innerHTML` 拼接改为 DOM `textContent` 渲染用户输入和模拟回复。
- Step 2.59：H5 onboarding choices DOM rendering 已实现并推送；H5 创建流程的常用称呼与性格特征选项从 `innerHTML` 拼接改为 DOM `textContent` 渲染和事件绑定。
- Step 2.60：H5 Covenant actions DOM rendering 已实现并推送；H5 生命周期操作区从 `actions.innerHTML` / inline `onclick` 改为 DOM `textContent` 渲染和事件绑定。
- Step 2.61：H5 loading bubble DOM rendering 已实现并推送；H5 对话等待回复气泡从 `insertAdjacentHTML` 字符串拼接改为 DOM `textContent` 渲染。
- Step 2.62：H5/public inline event handler binding 已实现并推送；H5 体验弹窗、官网咨询聊天、付费流程弹窗从 inline `on*=` 事件属性改为 `data-*` 标记和 JS 事件绑定。
- Step 2.63：public pricing CTA flow binding 已实现并推送；定价区方案卡片从跳转在线咨询区改为打开付费流程弹窗并预选对应方案。
- Step 2.64：public pricing dependency-safe copy 已实现并推送；公开页定价与付费流程文案移除终身/永久/无限/AI复刻/人格等依赖诱导或机制化表达，并补齐前台可见文案护栏。
- Step 2.65：public footer compliance links 已实现并推送；公开页页脚用户协议、隐私政策、伦理承诺不再是空链接，而是落到同页可见合规摘要，并新增 H5 静态测试防止 `href="#"` 与缺失 hash target 回归。

## 剩余目标状态

| # | 目标 | 当前状态 | 完成标准 |
|---|---|---|---|
| 1 | release validation suite | `release:validation-suite` 已实现；本地新增可选 `--evidence-out`；仍需要 snapshot/SQLite、`NNZ_POSTGRES_INTEGRATION_URL`、role token env、`NNZ_POSTGRES_SCOPED_RUNTIME_URL` | 一次运行 preflight、migration validation、Ops role smoke、runtime smoke suite；生成脱敏 evidence；任一 stage 失败时按 stage 修复后重跑 |
| 2 | 真实本地 snapshot + 一次性 Postgres migration | 已接入总 suite 的 `migration:validation-suite` stage | 生成 raw snapshot、sanitized report、sanitized summary；readiness 干净后 disposable DB smoke 通过 |
| 3 | 云端角色 token smoke | 已接入总 suite 的默认非破坏性 `ops:role-smoke` stage | 验证 viewer 只读、operator 可 dry-run、admin dry-run/confirmation boundary；不记录 token 明文、响应 payload、用户内容或 cleanup receipt |
| 4 | demo runtime scoped-table adapter | 已接入总 suite 的 `runtime:smoke-suite` stage | `/api/me/*`、chat、ops、cleanup、export/delete 都走 scoped tables，仍保持 `userId + personaId` 强隔离 |

## 推荐推进顺序

1. 注入 snapshot/SQLite、`NNZ_POSTGRES_INTEGRATION_URL`、Ops role tokens、`NNZ_POSTGRES_SCOPED_RUNTIME_URL`。
2. 运行 `release:validation-suite`，建议带 `--evidence-out <sanitized-release-evidence-json>` 生成脱敏上线证据。
3. 如果 suite 停在 preflight，补缺失输入后重跑。
4. 如果 suite 停在 migration readiness，审阅 sanitized report，修数据形状或迁移映射后重跑。
5. 如果 suite 停在 Ops/runtime stage，用对应单项命令做 focused diagnosis，修复后回到总 suite。

## 安全边界

- 不使用 `DATABASE_URL` 做 migration test 或 migration execution。
- 所有 migration integration 只读取 `NNZ_POSTGRES_INTEGRATION_URL`。
- `snapshot:export` 输出是完整敏感 snapshot，不能提交，不能贴到聊天或文档。
- `migration:readiness` 也会输出 raw snapshot；raw snapshot 只能留在本地，summary/report 才用于审阅。
- `migration:plan -- --summary` 可用于口头同步；`--report` 可用于审阅，但仍只保留 sanitized 结果。
- `migration:execute` 默认是 dry-run；真正执行必须同时传 `--execute`、`--database-url-env NNZ_POSTGRES_INTEGRATION_URL`、`--confirm EXECUTE_POSTGRES_SCOPED_MIGRATION`。
- `migration:smoke` 真正连接数据库前必须传 `--database-url-env NNZ_POSTGRES_INTEGRATION_URL` 和 `--confirm RUN_POSTGRES_SCOPED_MIGRATION_SMOKE`。
- `migration:validation-suite` 是目标 1+2 的推荐入口；真正连接数据库前必须传 `--database-url-env NNZ_POSTGRES_INTEGRATION_URL` 和 `--confirm RUN_POSTGRES_SCOPED_MIGRATION_VALIDATION_SUITE`；它先跑 offline readiness，readiness exit 0 后才跑 disposable smoke。
- `NNZ_POSTGRES_INTEGRATION_URL` 不能与 `DATABASE_URL` 或 `NNZ_POSTGRES_URL` 的值相同；两个受保护入口都会拒绝这种生产别名误配，且错误信息不打印 URL。
- `NNZ_RUNTIME_PERSISTENCE_MODE=scoped` 不使用 `DATABASE_URL` / `NNZ_POSTGRES_URL`，只允许通过 `NNZ_POSTGRES_SCOPED_RUNTIME_URL` 表达 scoped runtime 连接；缺专用 URL 仍 fail-fast，且诊断只暴露 env key / boolean。
- `runtime:smoke` 真正连接数据库前必须传 `--database-url-env NNZ_POSTGRES_SCOPED_RUNTIME_URL` 和 `--confirm RUN_POSTGRES_SCOPED_RUNTIME_SMOKE`；`NNZ_POSTGRES_SCOPED_RUNTIME_URL` 不能与 `DATABASE_URL` 或 `NNZ_POSTGRES_URL` 的值相同。
- `runtime:http-smoke` 真正连接数据库前必须先 `npm run build:demo`，再传 `--database-url-env NNZ_POSTGRES_SCOPED_RUNTIME_URL` 和 `--confirm RUN_POSTGRES_SCOPED_RUNTIME_HTTP_SMOKE`；它会启动真实 demo server，但 stdout/stderr 不输出 DB URL、token、email/password、memory/chat、credential hash、row payload、server log 或 raw error details。
- `runtime:smoke-suite` 是目标 4 的推荐入口；真正连接数据库前必须传 `--database-url-env NNZ_POSTGRES_SCOPED_RUNTIME_URL` 和 `--confirm RUN_POSTGRES_SCOPED_RUNTIME_SMOKE_SUITE`；它串行运行 direct smoke、`build:demo` 和 HTTP smoke，失败时不打印 child process output 或 raw details。
- `ops:role-smoke` 是目标 3 的推荐入口；默认只做非破坏性边界验证，必须传 `--base-url` 与 `--confirm RUN_OPS_ROLE_TOKEN_SMOKE`，并从本地 shell 读取 `NNZ_OPS_VIEWER_TOKEN` / `NNZ_OPS_OPERATOR_TOKEN` / `NNZ_OPS_ADMIN_TOKEN`。确认删除 smoke 还必须额外传 `--include-delete --delete-confirm RUN_OPS_ROLE_TOKEN_DELETE_SMOKE`。stdout/stderr 不打印 token 值、response payload、用户内容、cleanup receipt、server log 或 raw network details。
- `release:preflight` 是三类外部实跑前的本地检查入口；它只检查文件存在性和 env key 设置/别名冲突，不读取 snapshot 内容、不连接数据库、不发送网络请求，也不打印 snapshot 路径、数据库 URL、token 值、用户内容、cleanup receipt、server log 或 raw network details。
- `release:validation-suite` 是推荐总入口；必须传 `--confirm RUN_NNZ_RELEASE_VALIDATION_SUITE`，默认不执行 confirmed Ops cleanup deletion。它不打印数据库 URL、token 值、snapshot 内容、用户内容、cleanup receipt、child command output、server log、raw error details 或 evidence output path。
- `release:validation-suite -- --evidence-out <path>` 只写脱敏 evidence JSON：stage status、env key 名、本地产物类别、redaction 说明；不能写 snapshot input/output 路径、DB URL、token 值、用户内容、子命令输出、server log 或 raw error detail。
- 任何执行入口都必须保留 `userId + personaId` 作用域边界，不能引入 persona-only 查询。
- 用户端不可暴露 `SoulVersion`、`SoulSnapshot`、`scope`、`evidence`、`migration` 等后台机制。

## 当前可继续做的本地工作

- 用真实外部输入跑 `release:validation-suite -- --evidence-out <sanitized-release-evidence-json>`；默认仍保持 snapshot persistence，scoped runtime 只在 disposable DB smoke 中验证。
- 当前不需要为了 Step 2.56 / Step 2.60 / Step 2.61 / Step 2.62 / Step 2.63 / Step 2.64 / Step 2.65 再单独 push；核心上线闸口仍是上面的 release validation suite。没有外部输入时，继续本地开发只应做发布阻断级缺口或文档/交接纠偏，避免偏离 release validation 目标。

## 当前需要用户或外部环境提供的东西

- 一个本地 SQLite persistence 文件，或一个本地 `StoreSnapshot` JSON 文件路径。
- 一个一次性 Postgres 测试库 URL，用 `NNZ_POSTGRES_INTEGRATION_URL` 注入。
- Render 中是否已配置 `NNZ_OPS_VIEWER_TOKEN` / `NNZ_OPS_OPERATOR_TOKEN` / `NNZ_OPS_ADMIN_TOKEN` 的确认，以及本地 shell 中同名 env 值。
