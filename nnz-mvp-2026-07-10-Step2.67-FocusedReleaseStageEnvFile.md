# nnz-mvp 2026-07-10 Step 2.67 Focused Release Stage Env File

## 背景

Step 2.66 已让 `release:preflight` 和 `release:validation-suite` 支持显式 `--env-file`，可以读取被 `.gitignore` 忽略的 `.env.release`。继续审阅 release validation 排障路径时发现：如果总 suite 停在 migration、Ops role 或 runtime stage，后续通常需要运行对应单项命令做 focused diagnosis，但这些单项命令仍只能依赖当前 shell env。

这会让“总入口能读 `.env.release`，单项诊断又读不到”的摩擦重新出现。本步骤补齐单项 release stage 的 env-file parity，不改变任何数据库、网络或生产执行边界。

## 本次变更

- `migration:validation-suite` 支持 `--env-file <path>`，用于读取 `NNZ_POSTGRES_INTEGRATION_URL`。
- `runtime:smoke-suite` 支持 `--env-file <path>`，用于读取 `NNZ_POSTGRES_SCOPED_RUNTIME_URL`。
- `ops:role-smoke` 支持 `--env-file <path>`，用于读取 `NNZ_OPS_VIEWER_TOKEN` / `NNZ_OPS_OPERATOR_TOKEN` / `NNZ_OPS_ADMIN_TOKEN`。
- 三个单项入口继续保留既有 guardrail：
  - migration 只允许 `NNZ_POSTGRES_INTEGRATION_URL`，拒绝 `DATABASE_URL` / `NNZ_POSTGRES_URL`。
  - runtime 只允许 `NNZ_POSTGRES_SCOPED_RUNTIME_URL`，拒绝 `DATABASE_URL` / `NNZ_POSTGRES_URL`。
  - ops 默认非破坏性，确认删除 smoke 仍需要额外 `--include-delete --delete-confirm RUN_OPS_ROLE_TOKEN_DELETE_SMOKE`。
- CLI 输出继续不打印 env 文件路径、DB URL、token、用户内容、row payload、server log、child output 或 raw error details。
- README 补充三个 focused diagnosis 命令的 `--env-file .env.release` 示例。

## 回归覆盖

- 为 migration/runtime/ops 三个单项入口分别补充 env-file 回归测试。
- 测试确认能从 `.env.release` 读取对应 env key，同时 stdout/stderr 不泄露 env 文件路径或 secret 值。
- 不改变 `release:validation-suite` 的总入口顺序和 evidence 输出格式。

## 本地验证

```text
npm test -- postgres-scoped-migration-validation-suite postgres-scoped-runtime-smoke-suite ops-role-token-smoke
3 passed; 28 passed

npm run typecheck
passed

npm test
34 passed | 2 skipped; 237 passed | 2 skipped

npm run build:demo
passed

git diff --check
passed
```

## 状态

- Step 2.67 本地已完成，尚待下一次合并 push。
- Step 2.66 已完成、验证并推送，推送提交是 `d374cb4 feat: load release validation inputs from env file`。
- 本步骤仍不绕过真实外部输入要求；它只让总 suite 失败后的单项诊断能复用同一个被忽略 env 文件。
