# nnz-mvp 2026-06-30 Step 2.16：sanitized migration summary

## 目标

Step 2.16 的目标是在真实 snapshot dry-run 前，补一个更适合分享/审阅的 sanitized summary。

已有 `--report` 会输出 issue code/table/id，但仍会保留 issue id；`--summary` 只输出聚合 counts 和 code/table 汇总，不输出 issue message、用户 id、邮箱、memory/chat 正文。

## 范围

新增命令：

```text
npm run migration:plan -- --summary <snapshot-json-path>
```

新增 report 字段：

```text
summary
```

summary 内容：

- ready
- totalRows
- tableCount
- nonEmptyTableCount
- warningCount / errorCount
- warningsByCode / errorsByCode
- warningsByTable / errorsByTable
- rowBuildReady / executorReady
- nextAction

## 实施结果（2026-06-30）

已完成：

- `src/tools/postgres-scoped-migration-plan-cli.ts` 新增 `--summary`。
- `createSanitizedReport(...)` 新增 `summary` 字段。
- 新增 `createSanitizedSummary(...)` helper。
- `--summary` 与 `--json` 互斥，避免输出语义不清。
- 测试覆盖 summary 不输出 email、credential hash、memory/chat、issue message。
- 本地 smoke 验证 `--summary` 对有 blocking errors 的 snapshot 返回 exit code 2，且输出不含测试敏感值。

## 本地验证

```text
npm test -- src/tools/postgres-scoped-migration-plan-cli.test.ts --reporter verbose: passed, 10 tests
npm run typecheck: passed
npm run migration:plan -- --summary /tmp/nnz-summary-smoke.json: passed with expected exit code 2
sanitized summary content check: passed, no test memory/chat/user id
npm test: passed, 18 test files / 112 tests, 2 integration files skipped
npm run build:demo: passed
git diff --check: passed
```

## 下一步

1. 跑全量 `npm test` 与 `npm run build:demo`。
2. 用真实本地 snapshot 源运行：

```text
npm run snapshot:export -- --from-json <local-snapshot-wrapper.json> --out <snapshot-json-path>
npm run migration:plan -- --summary <snapshot-json-path>
npm run migration:plan -- --report <report-json-path> <snapshot-json-path>
```

3. 有一次性 Postgres 测试库后运行 repository + executor integration。

## 产品与伦理边界

本阶段是后端迁移审阅工具，不新增用户前台功能。

符合产品红线：

- 不改变 Covenant 节奏。
- 不增加用户依赖。
- 不向用户暴露 repository / scope / snapshot / migration 等机制。
- summary 专门减少敏感内容暴露，辅助安全审阅迁移风险。
