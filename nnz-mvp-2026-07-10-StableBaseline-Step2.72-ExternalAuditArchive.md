# nnz-mvp 2026-07-10 Stable Baseline Step 2.72 External Audit Archive

## 用途

这份档案用于交给另一个 AI / 审计者做任务分析、进度跟踪、潜在问题挖掘、完整度和风险评估。

本文只记录脱敏信息。不要把 `.env.release`、`release-artifacts`、raw snapshot、SQLite、Postgres URL、Render token、Ops token、session token、用户 memory/chat、credential hash、cleanup receipt 或任何 secret/raw data 复制到聊天、文档或仓库。

## 稳定基线身份

当前远端已推送基线：

```text
701266d feat: add short-lived ops sessions
```

当前稳定候选：

```text
701266d + 本稳定封存档案
```

状态说明：

- Step 2.72 已完成本地实现、全量验证并推送。
- 本稳定封存档案尚未由用户 push 成新的远端 commit。
- 用户下一次 push 建议合并为一个大版本，不再拆分小版本。
- Render 当前只按免费调试环境处理，不作为正式生产持久化承诺。

## 当前目标完成度

Step 2 release / migration goals:

```text
0 个未完成
```

公开上线前生产化 goals:

```text
2 类未完成
```

未完成类别：

1. 腾讯云正式环境方案评估。
2. 正式环境迁移 / 切换执行。

腾讯云评估必须基于当时最新官方信息、区域、价格、安全能力和产品约束；执行评估时应联网查官方资料，不要凭旧知识决策。

## 已完成关键门禁

- `release:validation-suite` 已在 2026-07-10 用真实 Render snapshot、隔离临时 Postgres database、Render viewer/operator/admin role tokens 和 scoped runtime 临时库完整通过。
- 通过 stage：
  - `releasePreflight`
  - `migrationValidationSuite`
  - `opsRoleSmoke`
  - `runtimeSmokeSuite`
- 脱敏 evidence 已写入 ignored `release-artifacts`，但不应提交、截图或粘贴。
- Step 2.70: Soul Ops optional IP allowlist hardening 已推送。
- Step 2.71: optional Ops audit retention 已推送。
- Step 2.72: optional short-lived Ops sessions 已实现、验证并推送。

## 最新本地验证

Step 2.72 后本地验证通过：

```text
npm test
npm run typecheck
npm run build:demo
git diff --check
```

全量测试结果：

```text
35 个测试文件通过
2 个 opt-in Postgres integration 测试跳过
250 tests passed / 2 skipped
```

## 运行模式与发布输入

默认 runtime persistence：

```text
NNZ_RUNTIME_PERSISTENCE_MODE=snapshot
```

Scoped runtime mode：

```text
NNZ_RUNTIME_PERSISTENCE_MODE=scoped
NNZ_POSTGRES_SCOPED_RUNTIME_URL=<dedicated scoped runtime database>
```

发布验证输入通过 ignored `.env.release` 提供。它只应保留在本地，不应提交、截图、粘贴或让模型输出其中的值。

## Ops 安全姿态

已实现能力：

- `NNZ_OPS_TOKEN` 兼容旧 admin token。
- `NNZ_OPS_VIEWER_TOKEN` / `NNZ_OPS_OPERATOR_TOKEN` / `NNZ_OPS_ADMIN_TOKEN` 支持角色化后台权限。
- `NNZ_OPS_ALLOWED_IPS` 可选保护 `/ops` 与 `/api/ops/*`。
- `NNZ_OPS_AUDIT_RETENTION_DAYS` / `NNZ_OPS_AUDIT_MAX_EVENTS` 可选裁剪 Ops audit。
- `NNZ_OPS_SESSION_TTL_MINUTES` 可选启用短期 Ops session。
- `ops:role-smoke` 自动兼容 direct-token 与 short-lived-session 模式。

边界：

- 短期 session 为空配置时不改变本地/调试默认行为。
- 启用 session 后，role token 只用于 `POST /api/ops/session` 创建短期 session，`/api/ops/*` 只接受 session token。
- `/ops` 页面只在 `sessionStorage` 保存 session token。
- stdout/stderr、日志和文档不能输出 role token、session token、DB URL、raw snapshot、用户内容或 cleanup receipt。

## 关键不变量

审计时优先检查这些不变量：

- 每条 Soul / Memory / Snapshot / Node / Conversation / Runtime / Proposal 访问路径必须携带 `userId + personaId`。
- 禁止 persona-only 查询。
- 禁止全局 `DeceasedSoul` 或跨用户合并人格。
- 用户端不能暴露 `SoulVersion`、`SoulSnapshot`、`Covenant raw state`、`scope`、`migration`、`evidence chain`、后台审核、模型机制词等内部概念。
- 用户可导出、删除、暂停、毕业；产品成功指标是帮助用户离开，不是制造长期依赖。
- Render 免费环境不得被误当正式生产环境。
- Disposable migration/runtime DB 不得与 `DATABASE_URL` / `NNZ_POSTGRES_URL` 生产别名同值。

## 审计入口文档

建议另一个 AI 先按顺序读：

```text
nnz-mvp/CLAUDE_CODE_HANDOFF.md
nnz-mvp/README.md
nnz-mvp-CURRENT-STATE.md
nnz-mvp-2026-07-01-Step2-MigrationReadinessRoadmap.md
nnz-mvp-2026-07-10-Step2.69-ReleaseValidationSuitePassed.md
nnz-mvp-2026-07-10-Step2.70-OpsIpAllowlistHardening.md
nnz-mvp-2026-07-10-Step2.71-OpsAuditRetention.md
nnz-mvp-2026-07-10-Step2.72-OpsShortLivedSessions.md
```

## 关键代码入口

建议重点审计：

```text
nnz-mvp/src/demo-server.ts
nnz-mvp/src/ops/ops-auth.ts
nnz-mvp/src/ops/ops-console.ts
nnz-mvp/src/ops/postgres-scoped-ops-store.ts
nnz-mvp/src/domain/soul-store.ts
nnz-mvp/src/domain/ops-audit-retention.ts
nnz-mvp/src/runtime/scoped-runtime-adapter.ts
nnz-mvp/src/runtime/scoped-runtime-persistence.ts
nnz-mvp/src/tools/release-validation-suite-cli.ts
nnz-mvp/src/tools/ops-role-token-smoke-cli.ts
```

## 已知剩余风险

- 正式生产基础设施尚未选型和执行迁移。
- Render Free Postgres 会过期/删除，只能视作调试环境。
- 腾讯云正式方案尚未完成，需要覆盖应用托管、托管 PostgreSQL、备份恢复、对象存储、KMS/Secret 管理、域名/证书、WAF/CDN、安全组、日志监控、CI/CD、回滚和成本。
- 真实微信 OAuth / 服务号链路仍不是完整生产形态。
- 生产级 encryption at rest / KMS / secret rotation 仍需正式环境方案落地。
- 多实例生产环境下，当前内存 Ops session 需要共享 session store 或 sticky session 策略。
- 支付、ICP备案、隐私影响评估、用户协议/隐私政策/伦理承诺仍需正式法律与合规审阅。
- LLM provider 的生产成本、限流、内容安全监控和故障降级策略仍需上线前再评估。

## 建议审计问题

- H5 / public / `/api/me/*` 是否仍无机制词泄漏？
- Step 2.72 的 short-lived Ops session 是否引入新的 CSRF、session fixation 或多实例失效风险？
- `ops:role-smoke` 在 direct-token 与 session 模式下是否都能覆盖 viewer/operator/admin 边界？
- 所有 migration/runtime smoke 是否仍拒绝生产 DB 别名误配？
- 用户导出/删除/毕业是否只影响当前登录用户，并保持 `userId + personaId` 作用域？
- 如果正式环境改动 runtime/migration/Ops 任一边界，是否已重跑 `release:validation-suite`？

## 下一步建议

1. 用户 push 当前稳定候选版本。
2. 另一个 AI 基于本档案做完整度和风险评估。
3. 下一轮开发转入腾讯云正式环境方案评估。
4. 正式迁移/切换前重新确认 release suite 输入、备份、回滚、监控和密钥管理策略。

## 建议 push Summary

```text
docs: archive step 2.72 stable baseline
```
