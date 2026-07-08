# nnz-mvp 2026-07-07 Step 2.41 H5 Graduation Inline Confirm

## 目标

补齐 H5 graduation 旅程中的确认体验：毕业是产品成功指标，也是一段重要的告别，不应该依赖浏览器 `confirm()`。此步骤不新增 migration CLI，不改变 scoped runtime / release validation 的外部实跑入口。

## 本次改动

- `nnz-mvp/public/index.html`
  - Covenant SEALED 状态下的“毕业”按钮改为打开页面内确认面板。
  - 确认面板说明毕业前会先导出数据档案，随后这段对话会安静封存。
  - 用户输入“告别”后才执行毕业。
  - `h5Graduate()` 保持先 `GET /api/me/export`、再 `POST /api/me/graduate`。
  - 毕业成功后收起确认面板并刷新状态。
- `nnz-mvp/src/h5-experience.test.ts`
  - 固化毕业按钮打开内联确认。
  - 固化页面不再使用 `confirm(`。
  - 固化确认词“告别”。
  - 固化数据导出仍发生在毕业提交前。

## 安全与产品边界

- 用户端没有新增 `SoulVersion`、`SoulSnapshot`、`scope`、`evidence`、`migration` 等后台机制词。
- 毕业仍然先交还用户数据档案，再提交毕业状态。
- 本次只改 H5 交互，不改 `userId + personaId` 作用域边界。

## 验证

```text
npm test -- h5-experience: 7 tests passed
npm run typecheck: passed
npm test: 34 个测试文件 passed，215 tests passed；2 个 integration 文件 skipped
npm run build:demo: passed
git diff --check: passed
```

## 下一步

- 本地 Step 2.41 建议与 Step 2.40 合并 push。
- 推送后，核心上线闸口仍是注入真实 snapshot/SQLite、disposable Postgres、Render role token env、scoped runtime DB 后运行 `release:validation-suite -- --evidence-out <sanitized-release-evidence-json>`。
