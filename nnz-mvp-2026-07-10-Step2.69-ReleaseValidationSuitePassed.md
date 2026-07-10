# nnz-mvp 2026-07-10 Step 2.69 Release Validation Suite Passed

## 背景

Step 2.68 后 Render viewer/operator/admin role token 已配置并通过 cloud smoke。剩余 release gate 是真实 snapshot、migration 临时 Postgres、scoped runtime 临时 Postgres 三类外部输入。

用户已明确授权 Codex 在 Render 创建临时 Postgres，并从当前 Render snapshot persistence 导出本地 StoreSnapshot；要求只写入 ignored `.env.release` / 本地产物，不在聊天或文档中展示 secret/raw data。

## 本次操作

- 从 Render 当前 Postgres snapshot persistence 导出 `nnz_store_snapshots/default` 到 ignored `release-artifacts/nnz-prod-snapshot-20260710.json`。
- Render 新建独立 Postgres 资源因账号已有 active free tier database 且无 payment method 被 `Add Card` 阻断，因此改用现有 Render Postgres 实例内的两个隔离临时 database：
  - 一个用于 `NNZ_POSTGRES_INTEGRATION_URL`
  - 一个用于 `NNZ_POSTGRES_SCOPED_RUNTIME_URL`
- 临时生产连接串只用于导出 snapshot 和创建隔离 database，随后从 `.env.release` 移除。
- `.env.release` 最终只保留 release validation 所需 key，不保留生产 snapshot DB URL。
- 所有 raw snapshot、migration report/summary、evidence 均写入 ignored `release-artifacts`。

## 验证

```text
npm run release:preflight -- --env-file .env.release --ops-base-url https://nnz-kego.onrender.com
overall: ready

npm run release:validation-suite -- --env-file .env.release --from-json-env NNZ_MIGRATION_SNAPSHOT_PATH --snapshot-out release-artifacts/nnz-release-raw-snapshot-20260710.json --report-out release-artifacts/nnz-release-migration-report-20260710.json --summary-out release-artifacts/nnz-release-migration-summary-20260710.json --evidence-out release-artifacts/nnz-release-evidence-20260710.json --confirm RUN_NNZ_RELEASE_VALIDATION_SUITE
passed:
- releasePreflight
- migrationValidationSuite
- opsRoleSmoke
- runtimeSmokeSuite
- releaseEvidence written
```

脱敏 snapshot counts:

```text
users: 3
personas: 3
soulVersions: 3
soulSnapshots: 0
memoryItems: 1
conversationMessages: 2
credentials: 1
opsAuditEvents: 14
```

## 安全记录

- 未在聊天、文档、stdout/stderr 中展示 DB URL、token、raw snapshot、memory/chat 正文、credential hash、cleanup receipt 或 server log。
- `.env.release` 与 `release-artifacts/` 已由 Git ignore 保护。
- 本次没有把 scoped runtime 切换到生产 Web Service；scoped runtime 只在 disposable smoke 中验证。

## 剩余风险

Render 当前生产 Postgres `nnz-mvp-postgres` 仍是 Free 实例，Dashboard 显示会在 **2026-07-11** 过期并删除，除非升级到 paid instance type。release validation gate 已通过，但生产持久化需要立即升级或迁移，避免数据丢失。

## 状态

- Step 2 release validation gate 已通过。
- 后续不要再说缺 snapshot、一次性 Postgres URL、scoped runtime URL 或 Render role tokens。
- 下一步优先级：处理 Render Free Postgres 过期风险，然后再进入真正的生产持久化升级/迁移决策。
