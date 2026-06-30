# nnz-mvp 2026-06-29 Step 2.15：StoreSnapshot export CLI

## 目标

Step 2.15 的目标是在已有 migration planner / row builder / executor 之前，补一个离线 `StoreSnapshot` 导出入口，让后续 dry-run 不需要手工拼 JSON。

本阶段仍不连接生产库：

- 不读取 `DATABASE_URL`。
- 不读取 `NNZ_POSTGRES_URL`。
- 不连接 Render。
- 不执行 scoped migration。
- 不新增 executor CLI 入口。

## 范围

新增命令：

```text
npm run snapshot:export -- --from-sqlite <sqlite-db-path> --out <snapshot-json-path>
npm run snapshot:export -- --from-json <snapshot-or-wrapper-json-path> --out <snapshot-json-path>
```

行为：

- 只从显式传入的本地文件读取。
- `--from-sqlite` 使用现有 `loadStore(...)` 读取本地 SQLite demo persistence。
- `--from-json` 接受 raw `StoreSnapshot`、`snapshot_json` wrapper、`rows[0].snapshot_json` wrapper。
- 默认不覆盖输出文件；需要 `--force` 才覆盖。
- stdout 只打印 counts 和下一步命令，不打印 memory / chat / credential hash / ops metadata 细节。
- 输出 JSON 是完整原始 `StoreSnapshot`，包含敏感数据，必须留在本地。

## 实施结果（2026-06-29）

已完成：

- 新增 `src/tools/store-snapshot-export-cli.ts`。
- 新增 `src/tools/store-snapshot-export-cli.test.ts`。
- `package.json` 新增 `snapshot:export` script。
- 测试覆盖 raw JSON、wrapper JSON、explicit SQLite path、拒绝覆盖、缺参不读文件。
- 本地 smoke 覆盖 `snapshot:export` -> `migration:plan -- --report` 串联，并确认 sanitized report 不包含测试 memory/chat 正文。

## 本地验证

```text
npm test -- src/tools/store-snapshot-export-cli.test.ts src/tools/postgres-scoped-migration-plan-cli.test.ts --reporter verbose: passed, 12 tests
npm run typecheck: passed
npm run snapshot:export -- --from-json /tmp/nnz-export-smoke-input.json --out /tmp/nnz-export-smoke-output.json --force: passed
npm run migration:plan -- --report /tmp/nnz-export-smoke-report.json /tmp/nnz-export-smoke-output.json: passed
sanitized report content check: passed, no smoke memory/chat text
npm test: passed, 18 test files / 109 tests, 2 integration files skipped
npm run build:demo: passed
git diff --check: passed
```

## 下一步

1. 跑全量 `npm test` 与 `npm run build:demo`。
2. 用真实本地 snapshot 源运行：

```text
npm run snapshot:export -- --from-json <local-snapshot-wrapper.json> --out <snapshot-json-path>
npm run migration:plan -- --report <report-json-path> <snapshot-json-path>
```

3. 有一次性 Postgres 测试库后运行 repository + executor integration。

## 产品与伦理边界

本阶段是后端迁移准备工具，不新增用户前台功能。

符合产品红线：

- 不改变 Covenant 节奏。
- 不增加用户依赖。
- 不向用户暴露 repository / scope / snapshot / migration 等机制。
- 为后续数据主权、导出、删除和毕业流程打基础。
