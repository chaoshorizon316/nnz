# nnz-mvp 2026-07-07 Step 2.39 H5 Delete Inline Confirm

## 目标

补齐产品进程审计指出的 export / delete 用户自助闭环缺口：用户在 H5 登录态删除全部数据前，应先看到清晰的页面内说明，知道删除不可恢复，并被提醒先导出自己的数据档案。此步骤不新增 migration CLI，不改变 scoped runtime / release validation 的外部实跑入口。

## 本次改动

- `nnz-mvp/public/index.html`
  - “删除全部数据”从浏览器 `prompt()` 改成页面内确认面板。
  - 面板说明删除会清除当前账号下的全部记忆、对话和创建内容，完成后无法恢复。
  - 面板提醒用户删除前建议先导出一份数据档案。
  - 用户输入“删除”后才提交既有 `/api/me/delete`。
  - 取消确认会收起面板并清空输入。
- `nnz-mvp/src/h5-experience.test.ts`
  - 固化删除确认面板存在。
  - 固化“不再使用 prompt()”。
  - 固化错误确认时提示并聚焦确认输入框。

## 安全与产品边界

- 用户端没有新增 `SoulVersion`、`SoulSnapshot`、`scope`、`evidence`、`migration` 等后台机制词。
- 后端删除路径不变，仍走 scoped `/api/me/delete`，只删除当前登录用户的数据。
- 后端确认常量仍只作为请求体发送，不作为用户主要体验文案。
- 本次只改 H5 删除交互，不改 `userId + personaId` 作用域边界。

## 验证

```text
npm test -- h5-experience: 5 tests passed
npm run typecheck: passed
npm test: 34 个测试文件 passed，212 tests passed；2 个 integration 文件 skipped
npm run build:demo: passed
git diff --check: passed
```

## 下一步

- 本地 Step 2.39 尚待下一次合并 push。
- 推送后，核心上线闸口仍是注入真实 snapshot/SQLite、disposable Postgres、Render role token env、scoped runtime DB 后运行 `release:validation-suite -- --evidence-out <sanitized-release-evidence-json>`。
