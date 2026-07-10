# nnz-mvp 2026-07-10 Step 2.68 Render Role Token Cloud Smoke

## 背景

Step 2.32 已实现 `ops:role-smoke`，Step 2.66/2.67 已让 release 总入口和 focused diagnosis 入口可以读取 ignored `.env.release`。剩余云端缺口是 Render Web Service 只有旧版 `NNZ_OPS_TOKEN`，尚未配置 viewer/operator/admin 三个角色化 token。

## 本次操作

- 在 Render Web Service `srv-d8go7pmq1p3s739r12jg` 的 Environment 页新增并保存：
  - `NNZ_OPS_VIEWER_TOKEN`
  - `NNZ_OPS_OPERATOR_TOKEN`
  - `NNZ_OPS_ADMIN_TOKEN`
- 三个 token 由本地生成，值不同且未在聊天、文档、stdout/stderr 或 Git 中展示。
- 同一组三个值同步写入 ignored `.env.release`，仅用于本地 release preflight / role smoke / release validation suite。
- 没有向 Render Web Service 添加 `NNZ_POSTGRES_INTEGRATION_URL`、`NNZ_POSTGRES_SCOPED_RUNTIME_URL`、snapshot/SQLite 路径或本地 artifact 路径；这些仍属于本地一次性验证输入。

## 验证

```text
git check-ignore -v .env.release
passed: .env.release is ignored by .gitignore

npm run release:preflight -- --env-file .env.release --ops-base-url https://nnz-kego.onrender.com
blocked as expected:
- opsRoleSmoke: ready
- migrationValidationSuite: blocked because snapshot input and NNZ_POSTGRES_INTEGRATION_URL are missing
- runtimeSmokeSuite: blocked because NNZ_POSTGRES_SCOPED_RUNTIME_URL is missing

npm run ops:role-smoke -- --env-file .env.release --base-url https://nnz-kego.onrender.com --confirm RUN_OPS_ROLE_TOKEN_SMOKE
passed:
- missingTokenRejected
- invalidTokenRejected
- viewerCanRead
- viewerCannotCleanup
- operatorCanDryRun
- operatorCannotDelete
- adminCanDryRun
- adminDeleteBoundary
- auditQueryReadable
```

## 状态

- Render role-specific Ops token stage 已单独通过。
- 本文是 Step 2.69 前的阶段记录；截至 2026-07-10，完整 `release:validation-suite` 已用真实 snapshot、隔离临时 Postgres database、scoped runtime 临时库和 Render role tokens 通过。
- 后续不要要求用户再次提供 Render role tokens、snapshot、一次性 `NNZ_POSTGRES_INTEGRATION_URL` 或一次性 `NNZ_POSTGRES_SCOPED_RUNTIME_URL`；相关输入已在 ignored `.env.release` / `release-artifacts` 中完成实跑，不可提交、截图或粘贴。
