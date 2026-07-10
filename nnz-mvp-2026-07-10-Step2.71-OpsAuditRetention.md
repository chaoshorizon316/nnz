# nnz-mvp 2026-07-10 Step 2.71 Ops Audit Retention

## 背景

Step 2 release validation gate 已通过，Render 仍定位为免费调试环境。Step 2.70 已补 Soul Ops optional IP allowlist；本次继续补上 Ops 审计保留策略，推进上线前生产化护栏。

## 本次实现

- 新增 `NNZ_OPS_AUDIT_RETENTION_DAYS`，设置为正整数时按天数裁剪旧 Ops audit event。
- 新增 `NNZ_OPS_AUDIT_MAX_EVENTS`，设置为正整数时只保留最新 N 条 Ops audit event。
- 两个配置均为空时保持本地/调试环境现状，不裁剪。
- 每次 Ops audit write 后执行 retention：
  - snapshot / SQLite / JSONB persistence 路径通过 `InMemorySoulStore.pruneOpsAuditEvents()` 裁剪。
  - scoped Postgres Ops 路径通过 `PostgresScopedOpsStore.pruneOpsAuditEvents()` 裁剪。
- `.env.example`、README、handoff、roadmap、CURRENT-STATE 已记录该配置。

## 安全边界

- 不改变现有 viewer/operator/admin token 权限。
- 不改变默认调试行为。
- 不在日志、文档或 stdout/stderr 中输出 audit payload、用户内容、token、DB URL、来源 IP 或 raw child output。
- Retention 只作用于 Ops audit events，不触碰用户 Soul、Memory、Conversation、Credential 或 scoped runtime 数据。

## 验证

本地验证通过：

```text
npm test -- src/domain/ops-audit-retention.test.ts src/ops/postgres-scoped-ops-store.test.ts src/demo-server-consent.test.ts
npm test
npm run typecheck
npm run build:demo
git diff --check
```

全量测试结果：35 个测试文件通过、2 个 opt-in Postgres integration 测试跳过，247 tests passed / 2 skipped。

## 当前目标计数

- Step 2 release/migration goals: 0 个未完成。
- 公开上线前生产化 goals: 3 类未完成：
  1. Ops 短期 session / 登录策略。
  2. 腾讯云正式环境方案评估。
  3. 正式环境迁移 / 切换执行。

## 状态

- 本地实现与 targeted 验证完成。
- 下一步建议继续 Ops session 策略，或在用户要求时转入腾讯云正式环境方案评估。
