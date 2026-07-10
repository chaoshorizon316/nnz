# nnz-mvp 2026-07-10 Step 2.66 Release Env File Inputs

## 背景

Step 2.65 推送后，继续推进 release validation 时确认：当前 Codex 进程、macOS `launchctl` 环境和本地 shell profile 都没有 `NNZ_POSTGRES_INTEGRATION_URL`、`NNZ_POSTGRES_SCOPED_RUNTIME_URL`、`NNZ_OPS_VIEWER_TOKEN`、`NNZ_OPS_OPERATOR_TOKEN`、`NNZ_OPS_ADMIN_TOKEN`。仓库内唯一 `.env` 只包含 LLM 配置和 `NNZ_DB_PATH`，且当前 `NNZ_DB_PATH` 指向的文件不存在。

这说明外部输入没有被当前进程实际拿到。但用户提到“该预留的应该都提供了”，所以本步骤把 release 工具从“只能依赖当前 shell env”推进为“可以显式加载被忽略的本地 env 文件”，并允许从 env key 读取 SQLite/JSON 输入路径，减少后续用户把值放在 `.env.release` 后的操作摩擦。

## 本次变更

- 新增 `src/tools/release-env-file.ts`，用于显式加载本地 env 文件。
- `release:preflight` 新增 `--env-file <path>`，可配合 `--snapshot-env NNZ_DB_PATH` 或 `NNZ_MIGRATION_SNAPSHOT_PATH` 做脱敏预检。
- `release:validation-suite` 新增 `--env-file <path>`、`--from-json-env <env-key>`、`--from-sqlite-env <env-key>`。
- env 文件只在显式传入时读取；当前 shell 中已有的非空 env 值优先于文件值。
- CLI 输出继续不打印 env 文件路径、snapshot 路径、DB URL、token、用户内容、子命令输出或 raw error。
- `.env.example` 和 README 补充 `.env.release` / env-key 输入用法。

## 当前实测结论

使用当前本地 `.env` 执行：

```text
npm run release:preflight -- --env-file .env --snapshot-env NNZ_DB_PATH --ops-base-url https://nnz-kego.onrender.com
```

结果仍是 `overall: blocked`：

- `snapshotInput: blocked (NNZ_DB_PATH)`，因为当前 `NNZ_DB_PATH` 指向的文件不存在。
- `NNZ_POSTGRES_INTEGRATION_URL` missing。
- `NNZ_OPS_VIEWER_TOKEN` / `NNZ_OPS_OPERATOR_TOKEN` / `NNZ_OPS_ADMIN_TOKEN` missing。
- `NNZ_POSTGRES_SCOPED_RUNTIME_URL` missing。

使用当前本地 `.env` 执行新的 validation suite env-file 入口：

```text
npm run release:validation-suite -- --env-file .env --from-sqlite-env NNZ_DB_PATH --snapshot-out release-artifacts/raw.json --report-out release-artifacts/report.json --summary-out release-artifacts/summary.json --confirm RUN_NNZ_RELEASE_VALIDATION_SUITE
```

结果会安全停在 `release preflight`，且不打印 env 文件路径、DB URL、token、snapshot path、snapshot 内容或 raw 子命令输出。

## 本地验证

```text
npm test -- release-preflight release-validation-suite
2 passed; 18 passed

npm run typecheck
passed

npm run build:demo
passed

npm test
34 passed | 2 skipped; 234 passed | 2 skipped

git diff --check
passed
```

## 状态

- Step 2.66 本地已完成，尚待下一次合并 push。
- 最新已推送提交是 `e5810ff docs: mark step 2.65 as pushed`。
- 本步骤没有绕过外部输入要求；它只让已经预留在本地 env 文件中的输入可以被 release CLI 安全读取。
- 真正上线放行仍取决于外部输入齐备后的 `release:validation-suite -- --env-file <ignored-env-file> --from-json-env <snapshot-env>` 或 `--from-sqlite-env <sqlite-env>`。
