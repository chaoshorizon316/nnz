# nnz-mvp 2026-07-07 Step 2.36 Sensitive Local Release Safety

## 背景

`nnz-mvp-2026-07-01-产品进程审计与完整度评估.md` 指出：raw snapshot / readiness output 可能包含 memory、chat、credential hash，而 `.gitignore` 当时没有显式忽略 `*snapshot*.json`、`*migration*report*.json` 等本地导出物。

Step 2.35 已经新增 release evidence output；真实上线验证会同时生成 raw snapshot、sanitized report、sanitized summary、sanitized evidence。为了降低误提交和误配置风险，本次补两个本地安全护栏：ignore guard 和 env template。

## 已实现

1. 根 `.gitignore` 新增敏感本地数据与 release artifact 规则：

- `*.db`
- `*.db-shm`
- `*.db-wal`
- `*.sqlite`
- `*.sqlite3`
- `*snapshot*.json`
- `*migration*report*.json`
- `*migration*summary*.json`
- `*readiness*report*.json`
- `*readiness*summary*.json`
- `*release*evidence*.json`
- `*validation*evidence*.json`
- `raw.json`
- `report.json`
- `summary.json`
- `evidence.json`
- `migration-artifacts/`
- `release-artifacts/`
- `snapshot-exports/`

2. 新增 `nnz-mvp/.env.example`：

- 只包含空值和安全注释，不包含真实 URL、token 或 API key。
- 明确区分 local demo、optional LLM、snapshot runtime、Ops token、release validation inputs。
- 标明 `NNZ_POSTGRES_INTEGRATION_URL` 与 `NNZ_POSTGRES_SCOPED_RUNTIME_URL` 只能使用 disposable databases，不能等于 `DATABASE_URL` 或 `NNZ_POSTGRES_URL`。
- 继续保留 `.env` 私密本地文件不入库。

## 验证

已验证会被忽略：

```text
raw.json
report.json
summary.json
evidence.json
release-artifacts/release-evidence.json
snapshot-exports/prod-snapshot.json
migration-artifacts/migration-summary.json
local.sqlite
local.db
```

已验证不会被忽略：

```text
nnz-mvp/package.json
nnz-mvp/package-lock.json
nnz-mvp/tsconfig.json
nnz-mvp/.env.example
nnz-mvp-2026-07-07-Step2.35-ReleaseEvidence.md
```

全量验证：

```text
npm run typecheck: passed
npm test: 32 个测试文件、206 tests passed；2 个 integration 文件 skipped
npm run build:demo: passed
git diff --check: passed
```

## 安全边界

- `.gitignore` 是防误提交护栏，不替代命令本身的脱敏输出。
- `.env.example` 只能放 env key 和空 placeholder，不能填任何真实 secret。
- raw snapshot 仍必须只留在本地，不应贴入聊天、文档或 issue。
- sanitized report / summary / evidence 虽不含用户内容，也应按 release artifact 管理，默认不提交。
- 若未来需要提交固定 fixture JSON，应使用不匹配这些本地产物命名的路径，并先人工确认不含用户数据。

## 下一步

1. 外部输入齐备后运行带 `--evidence-out` 的 `release:validation-suite`。
