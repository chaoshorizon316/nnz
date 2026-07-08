# nnz-mvp 2026-07-07 Step 2.40 H5 Memory Append UX/API

## 目标

补齐产品进程审计指出的 onboarding / memory collection 前台缺口：用户创建记忆伙伴后，可以继续补充一段已经发生过的细节，而不是只能在创建表单里一次性写完。此步骤不新增 migration CLI，不改变 scoped runtime / release validation 的外部实跑入口。

## 本次改动

- `nnz-mvp/src/demo-server.ts`
  - 新增 `POST /api/me/memory`。
  - 要求当前登录用户、`personaId` 和非空内容。
  - 通过 `requireUserPersonaRuntime(res, authUser.userId, body.personaId)` 绑定当前用户的 scoped runtime。
  - 写入 `DESCRIPTION` memory，`enabledForSoul: true`，并持久化。
- `nnz-mvp/public/index.html`
  - H5 对话区新增“补充记忆”按钮。
  - 新增页面内补充记忆面板。
  - 文案限定为“已经发生过的细节”，并提醒“只补充你愿意留下的内容”。
  - 保存成功后更新对话 / 记忆计数。
- `nnz-mvp/src/tools/postgres-scoped-runtime-http-smoke-cli.ts`
  - scoped runtime HTTP smoke 增加 `/api/me/memory` 步骤。
  - 导出断言同时覆盖创建描述和后续补充记忆。
- `nnz-mvp/src/h5-experience.test.ts`
  - 固化 H5 补充记忆面板、保存请求和用户文案。
- `nnz-mvp/src/demo-server-consent.test.ts`
  - 固化 `/api/me/memory` 必须走当前登录用户的 scoped persona runtime。
- `nnz-mvp/src/tools/postgres-scoped-runtime-http-smoke-cli.test.ts`
  - 固化 HTTP smoke 输出 `memoryAppend: yes`。

## 安全与产品边界

- 用户端没有新增 `SoulVersion`、`SoulSnapshot`、`scope`、`evidence`、`migration` 等后台机制词。
- API 仍以当前登录用户绑定 persona，避免 persona-only 写入。
- 补充记忆文案强调“已经发生过的细节”，符合 time-frozen persona 约束。
- 本次复用既有 scoped runtime memory 表和 adapter，不新增迁移路径。

## 验证

```text
npm test -- h5-experience demo-server-consent postgres-scoped-runtime-http-smoke-cli: 16 tests passed
npm run typecheck: passed
npm test: 34 个测试文件 passed，214 tests passed；2 个 integration 文件 skipped
npm run build:demo: passed
git diff --check: passed
```

## 下一步

- 本地 Step 2.40 尚待下一次合并 push。
- 推送后，核心上线闸口仍是注入真实 snapshot/SQLite、disposable Postgres、Render role token env、scoped runtime DB 后运行 `release:validation-suite -- --evidence-out <sanitized-release-evidence-json>`。
