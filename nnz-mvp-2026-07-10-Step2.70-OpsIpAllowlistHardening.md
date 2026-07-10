# nnz-mvp 2026-07-10 Step 2.70 Ops IP Allowlist Hardening

## 背景

Step 2.69 已完成真实 release validation gate，Render 当前仍定位为免费调试环境，不作为正式生产持久化承诺。下一阶段本地工作应从“补外部输入”转向上线前生产化护栏，优先收敛 Soul Ops 后台访问边界。

## 本次实现

- 新增 `NNZ_OPS_ALLOWED_IPS` 配置项；为空时保持本地/调试环境行为不变。
- 当 `NNZ_OPS_ALLOWED_IPS` 非空时，`/ops` 页面和 `/api/ops/*` 在 token 检查前先执行来源 allowlist。
- allowlist 支持逗号分隔的精确 IP 和 IPv4 CIDR。
- 代理环境优先读取第一段 `x-forwarded-for`，其次读取 `x-real-ip`，最后读取 socket remote address。
- Ops access-denied audit 只记录 allowlist 已启用和是否存在来源 IP，不写 raw IP。
- `.env.example`、README、handoff、roadmap 和 CURRENT-STATE 已记录该配置与后续方向。

## 安全边界

- 不改变现有 viewer/operator/admin token 权限模型。
- 不改变默认调试环境行为。
- 不把 token、DB URL、snapshot、用户内容或来源 IP 明文写入文档。
- 该切片只补 Ops perimeter 的第一层；正式生产仍需继续定义 session 策略、审计保留策略和云侧网络边界。

## 验证

本地验证通过：

```text
npm test -- src/ops/ops-auth.test.ts src/demo-server-consent.test.ts
npm test
npm run typecheck
npm run build:demo
git diff --check
```

全量测试结果：34 个测试文件通过、2 个 opt-in Postgres integration 测试跳过，242 tests passed / 2 skipped。

## 状态

- 本地实现与验证完成。
- 下一步建议继续 Ops 生产化护栏，或在用户要求时转入腾讯云正式环境方案评估。
