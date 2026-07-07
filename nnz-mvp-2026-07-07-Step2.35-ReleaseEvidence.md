# nnz-mvp 2026-07-07 Step 2.35 Release Evidence

## 目标

在 `release:validation-suite` 已经能串起外部上线验证后，补一份可交接、可审计、但不泄密的本地 evidence JSON。

这个 evidence 是 admin/developer release artifact，不属于用户前台功能，不改变默认 runtime persistence，也不引入任何用户可见机制文案。

## 已实现

- `release:validation-suite` 新增可选 `--evidence-out <sanitized-evidence-json-path>`。
- 缺少 `--confirm RUN_NNZ_RELEASE_VALIDATION_SUITE` 或参数错误时不写 evidence。
- suite 全部通过时写：
  - `status: "passed"`
  - `releasePreflight` / `migrationValidationSuite` / `opsRoleSmoke` / `runtimeSmokeSuite` 均为 `passed`
- 确认执行后若某 stage 失败时写：
  - `status: "failed"`
  - `failedStage`
  - 已执行成功的 stage 为 `passed`
  - 失败 stage 为 `failed`
  - 未执行 stage 为 `not_run`
- 写 evidence 失败时只返回固定脱敏错误，不打印路径或底层 filesystem error。

## Evidence 内容边界

只允许写：

- stage 状态
- snapshot source 类型：`json` 或 `sqlite`
- env key 名：`NNZ_POSTGRES_INTEGRATION_URL`、`NNZ_POSTGRES_SCOPED_RUNTIME_URL`、`NNZ_OPS_VIEWER_TOKEN`、`NNZ_OPS_OPERATOR_TOKEN`、`NNZ_OPS_ADMIN_TOKEN`
- runtime build 是否 required/skipped
- 本地产物类别：raw snapshot / sanitized report / sanitized summary
- redaction 说明

禁止写：

- snapshot input path
- raw snapshot output path
- sanitized report / summary output path
- evidence output path
- database URL
- token value
- user content
- cleanup receipt
- child command stdout/stderr
- server log
- raw error detail

## 推荐命令

```bash
npm run release:validation-suite -- --from-json <snapshot-or-wrapper-json-path> --snapshot-out <raw-snapshot-json-path> --report-out <sanitized-report-json-path> --summary-out <sanitized-summary-json-path> --evidence-out <sanitized-evidence-json-path> --confirm RUN_NNZ_RELEASE_VALIDATION_SUITE
npm run release:validation-suite -- --from-sqlite <sqlite-db-path> --snapshot-out <raw-snapshot-json-path> --report-out <sanitized-report-json-path> --summary-out <sanitized-summary-json-path> --evidence-out <sanitized-evidence-json-path> --confirm RUN_NNZ_RELEASE_VALIDATION_SUITE
```

## 当前验证

```text
npm test -- src/tools/release-validation-suite-cli.test.ts --reporter verbose: 10 tests passed
npm run typecheck: passed
npm run release:validation-suite -- --help: passed
npm run release:validation-suite -- --from-json missing-snapshot.json --snapshot-out raw.json --report-out report.json --summary-out summary.json --evidence-out /private/tmp/nnz-release-evidence-smoke.json --confirm RUN_NNZ_RELEASE_VALIDATION_SUITE: failed during release preflight as expected, no DB/network stage, evidence JSON sanitized
npm test: 32 个测试文件、206 tests passed；2 个 integration 文件 skipped
npm run build:demo: passed
git diff --check: passed
```

## 下一步

1. push Step 2.35。
2. 外部输入齐备后运行带 `--evidence-out` 的 `release:validation-suite`。
