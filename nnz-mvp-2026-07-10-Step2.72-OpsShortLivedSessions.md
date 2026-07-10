# nnz-mvp 2026-07-10 Step 2.72 Ops Short-Lived Sessions

## 背景

Step 2.70 已补 Soul Ops IP allowlist，Step 2.71 已补 Ops audit retention。剩余本地可闭环的 Ops 生产化护栏是避免浏览器长期保存 role token。

## 本次实现

- 新增 `NNZ_OPS_SESSION_TTL_MINUTES` 正整数配置。
- 为空时保持本地/调试环境现状，`/api/ops/*` 继续接受 role token。
- 设置后：
  - `POST /api/ops/session` 用 role token 创建短期 session。
  - 受保护 `/api/ops/*` 只接受 session token，不再接受 role token 直连。
  - `/ops` 页面只在 `sessionStorage` 保存短期 session token，并清空输入框里的 role token。
  - session 创建写入 `SESSION_CREATE` Ops audit event，不记录 token 值。
- `ops:role-smoke` 自动探测 session endpoint：
  - 未启用 session 时使用 `direct-token` 模式。
  - 启用 session 时换取 viewer/operator/admin session token 后继续验证权限边界。
  - stdout/stderr 只输出 `sessionMode`，不输出 role token 或 session token。

## 安全边界

- 不改变 viewer/operator/admin 角色权限。
- 不改变默认调试行为。
- session 仅存内存；服务重启后自动失效。
- 不在日志、文档或 stdout/stderr 中输出 role token、session token、DB URL、raw snapshot、用户内容、cleanup receipt 或 server log。

## 验证

本地验证通过：

```text
npm test -- src/tools/ops-role-token-smoke-cli.test.ts src/ops/ops-auth.test.ts src/demo-server-consent.test.ts
npm test
npm run typecheck
npm run build:demo
git diff --check
```

全量测试结果：35 个测试文件通过、2 个 opt-in Postgres integration 测试跳过，250 tests passed / 2 skipped。

## 当前目标计数

- Step 2 release/migration goals: 0 个未完成。
- 公开上线前生产化 goals: 2 类未完成：
  1. 腾讯云正式环境方案评估。
  2. 正式环境迁移 / 切换执行。

## 状态

- 本地实现与验证完成。
- 下一步建议转入腾讯云正式环境方案评估；该部分需要基于当前云产品、价格和区域信息，开始前应联网查官方资料。
