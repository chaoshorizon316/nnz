# nnz-mvp 2026-07-07 Step 2.38 H5 Onboarding Consent UX

## 目标

补齐产品进程审计指出的 H5 onboarding / consent 缺口：用户创建记忆伙伴前，需要确认使用边界和自己的数据权利；API 层也同步要求该确认，避免绕过 H5 创建。此步骤不新增 migration CLI，不改变 scoped runtime / release validation 的外部实跑入口。

## 本次改动

- `nnz-mvp/public/index.html`
  - H5 创建体验第 3 步新增确认勾选。
  - 文案确认这是一段辅助性的记忆对话，不替代身边的人或专业帮助。
  - 文案确认用户可以随时导出或删除自己的数据。
  - `h5CreatePersona()` 未勾选时阻止创建，提示“请先确认使用边界和数据权利。”，回到第 3 步并聚焦确认框。
  - 创建请求向 `/api/me/persona` 显式传入 `consentAccepted: true`。
  - `h5ShowCreatePanel()` 新建另一位记忆伙伴时重置确认状态，避免复用上一位的确认。
- `nnz-mvp/src/demo-server.ts`
  - `POST /api/me/persona` 要求 body 带 `consentAccepted: true`，否则返回 400。
- `nnz-mvp/src/tools/postgres-scoped-runtime-http-smoke-cli.ts`
  - HTTP smoke 创建 persona 时同步传入 `consentAccepted: true`。
- `nnz-mvp/src/h5-experience.test.ts`
  - 固化确认框存在。
  - 固化边界与数据权利文案。
  - 固化创建前校验和新建重置行为。
- `nnz-mvp/src/demo-server-consent.test.ts`
  - 固化 `/api/me/persona` 的 API 层确认校验。

## 安全与产品边界

- 用户端没有新增 `SoulVersion`、`SoulSnapshot`、`scope`、`evidence`、`migration` 等后台机制词。
- 本次只新增请求确认字段校验，没有新增持久化字段，也没有改动 `userId + personaId` 作用域边界。
- 确认发生在创建第一位或新一位记忆伙伴之前，符合“先告知，再创建”的用户旅程。
- 数据导出与删除仍走既有 `/api/me/export` 和 `/api/me/delete`，不改变数据主权后端路径。

## 验证

```text
npm test -- h5-experience demo-server-consent postgres-scoped-runtime-http-smoke-cli: 13 tests passed
npm run typecheck: passed
npm test: 34 个测试文件 passed，211 tests passed；2 个 integration 文件 skipped
npm run build:demo: passed
git diff --check: passed
localhost API smoke: missing consent returns 400；`consentAccepted:true` creates persona successfully
```

## 下一步

1. 合并 push Step 2.38。
2. 外部输入齐备后运行带 `--evidence-out` 的 `release:validation-suite`。
