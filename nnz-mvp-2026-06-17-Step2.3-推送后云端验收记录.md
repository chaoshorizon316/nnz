# nnz-mvp 2026-06-17 Step 2.3：推送后云端验收记录

## Summary

Step 2.3 已由用户推送到 GitHub，云端基础验收通过。

本次验收确认：

- GitHub `main` 已到 `a9735a5 feat: add soul ops audit query`。
- GitHub Actions `NNZ MVP CI` 最新 run 成功。
- Render 云端 `/healthz` 仍为 Postgres 持久化。
- Render 云端 `/ops` 已包含 `Dashboard / Audit` tab 和 Audit 查询控件。
- Render 云端 `GET /api/ops/audit-events` 已部署并返回正确鉴权边界：
  - 无 token：401。
  - 错 token：403。

本次没有读取或记录任何 token 明文。

## GitHub 状态

仓库：

```text
https://github.com/chaoshorizon316/nnz
```

最新提交：

```text
a9735a5 feat: add soul ops audit query
```

GitHub Actions：

```text
Workflow: NNZ MVP CI
Run: 27677337466
URL: https://github.com/chaoshorizon316/nnz/actions/runs/27677337466
Status: completed
Conclusion: success
Created: 2026-06-17T08:52:25Z
Updated: 2026-06-17T08:52:55Z
```

## Render 状态

Render URL：

```text
https://nnz-kego.onrender.com
```

Health check：

```bash
curl -s https://nnz-kego.onrender.com/healthz
```

返回要点：

```json
{
  "ok": true,
  "service": "nnz-mvp-demo",
  "fixture": "postgres",
  "persistence": {
    "mode": "postgres",
    "postgresConfigured": true,
    "postgresEnv": "DATABASE_URL",
    "sqliteConfigured": false
  }
}
```

## `/ops` 页面验收

命令：

```bash
curl -s -o /tmp/nnz-cloud-ops.html -w "%{http_code}" https://nnz-kego.onrender.com/ops
```

结果：

```text
HTTP 200
```

HTML 中确认存在：

```text
Soul Ops token
Dashboard
Audit Events
auditAction
/api/ops/audit-events
```

说明：

- 云端已部署 Step 2.3 的 `/ops` Audit tab。
- 这只是页面静态与 API 路径确认，不需要输入后台 token。

## Audit API 鉴权验收

### 无 token

命令：

```bash
curl -i https://nnz-kego.onrender.com/api/ops/audit-events
```

结果：

```text
HTTP/2 401
{
  "error": "缺少 Soul Ops 访问 token。"
}
```

### 错 token

命令：

```bash
curl -i -H "x-ops-token: definitely-wrong-token" \
  https://nnz-kego.onrender.com/api/ops/audit-events
```

结果：

```text
HTTP/2 403
{
  "error": "Soul Ops 访问 token 无效。"
}
```

## Role Token 状态

本次没有拿到任何可用的 viewer/operator/admin token 明文，因此没有执行：

- viewer 查询 audit 200。
- viewer cleanup 403。
- operator cleanup dry-run 200。
- operator confirmed delete 403。
- admin audit query 200。

只读查看 Render Environment 页时，没有在可见文本里可靠识别到 `NNZ_OPS_VIEWER_TOKEN`、`NNZ_OPS_OPERATOR_TOKEN`、`NNZ_OPS_ADMIN_TOKEN` 键名。该结果不代表变量一定不存在，因为 Render 可能不在当前可读 DOM 中暴露 secret 列表。

下一步如果要完成角色 token 云端 smoke，需要用户提供以下任一方式：

1. 用户在本地临时设置环境变量后让 Codex 使用：

```bash
NNZ_OPS_VIEWER_TOKEN=...
NNZ_OPS_OPERATOR_TOKEN=...
NNZ_OPS_ADMIN_TOKEN=...
```

2. 用户手动在浏览器 `/ops` 页面输入对应 token 验证角色显示和权限按钮。
3. 用户确认 Render 已配置这些变量，并提供一次性测试 token 值。

注意：不要把 token 明文写入仓库、知识库或提交记录。

## Next Plan

建议进入 Step 2.4：

1. 完成云端角色 token smoke。
2. 将 `/ops` 内联 HTML/JS 拆成更清晰的 Admin Web 模块。
3. 开始 scoped repository 设计与实施：
   - 从 Postgres snapshot persistence 演进为逐表 repository。
   - 所有 Soul / Memory / Snapshot / Proposal / Conversation 查询继续强制携带 `userId + personaId`。
4. 增加审计导出与保留策略：
   - 按时间范围导出。
   - metadata-only。
   - 不导出 token、聊天正文、上传资料正文。

