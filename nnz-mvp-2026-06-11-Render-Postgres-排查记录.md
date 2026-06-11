# nnz-mvp 2026-06-11 Render Postgres 排查与验收记录

> 目标：记录云端 demo 从 `fixture: "in-memory"` 切换到 Render Postgres 的完整排查、配置、验证结果，并给下一位 AI / Claude Code 留下可继续执行的上下文。

## 结论

2026-06-11 已完成 Render Postgres 接入。Web Service `nnz` 已配置 `DATABASE_URL`，最新线上健康检查已稳定显示 Postgres 持久化。

当前线上健康检查：

```text
https://nnz-kego.onrender.com/healthz
fixture = "postgres"
persistence.mode = "postgres"
persistence.postgresConfigured = true
persistence.postgresEnv = "DATABASE_URL"
persistence.sqliteConfigured = false
```

本次还完成了重启持久化 smoke：

```text
注册临时测试用户
创建 persona: 爸爸 / 孩子
发送一句话
chat-history = 2 条（USER + ASSISTANT）
Render Manual Deploy -> Restart service
重新登录同一测试用户
persona 和 chat-history 均可读回
persistedAfterRestart = true
```

## Render 控制台对象

```text
Web Service: nnz
Service ID: srv-d8go7pmq1p3s739r12jg
URL: https://nnz-kego.onrender.com
Repo: chaoshorizon316/nnz
Branch: main
Root Directory: nnz-mvp
Auto Deploy: On Commit
```

数据库：

```text
Name: nnz-mvp-postgres
Service ID: dpg-d8l271hkh4rs73fmdtn0-a
Project / Environment: My project / Production
Region: Ohio (US East)
Instance Type: Free
Storage: 1 GB
Monthly Total: $0 / month
Expiration: July 11, 2026
```

Web Service `nnz` 当前关键 env key：

```text
DATABASE_URL
NNZ_LLM_API_KEY
NNZ_LLM_BASE_URL
NNZ_LLM_MODEL
```

只记录 key 名，不记录 secret value。数据库连接串、LLM key、token、测试密码都不能写入仓库、普通文档或聊天记录。

## 排查过程

初始状态：

```text
/healthz fixture = "in-memory"
persistence.postgresConfigured = false
```

原因：代码侧 Postgres snapshot persistence 已合入并通过 CI，但 Render Web Service 当时没有 `DATABASE_URL` / `NNZ_POSTGRES_URL`。项目 Env Groups 为 0，因此不是 Env Group 未链接。

第一次配置后手动部署失败，日志显示：

```text
Postgres persistence configured via DATABASE_URL.
Failed to start demo server: getaddrinfo ENOTFOUND base
```

判断：`DATABASE_URL` 被错误值污染，运行时解析出的 host 是 `base`，不是 Postgres 主机。

修正：

1. 重新打开 Render Postgres `nnz-mvp-postgres`。
2. 复制完整 Postgres URL，程序只校验协议、host、路径，不输出 secret。
3. 覆盖 Web Service `DATABASE_URL`。
4. 发现 Render 编辑态会把 secret 字段显示为空或点状遮罩，这表示平台保护值，不等于 secret 被清空。
5. 确认 `NNZ_LLM_MODEL=deepseek-v4-pro` 仍存在；日志确认 LLM adapter 仍初始化。
6. 保存时选择 `Save, rebuild, and deploy`。
7. 最新部署变为 `Deploy live`。

当前 runtime logs 可见：

```text
Postgres persistence configured via DATABASE_URL.
LLM adapter initialized for extraction pipeline.
```

说明：

- 当前 `DATABASE_URL` 使用 Render Postgres URL，代码会对 `postgres://` / `postgresql://` 自动启用 SSL。
- Render 页面提示 External URL 主要用于 Render 外部连接；如果未来切回 Internal URL，必须重新做 `/healthz` 和重启后数据恢复 smoke。
- 不要把 Internal / External URL 写进文档。

## 代码增强

2026-06-11 已给 `/healthz` 增加不泄露密钥的诊断字段：

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

字段含义：

- `postgresConfigured` 只表示是否读到非空 `NNZ_POSTGRES_URL` 或 `DATABASE_URL`。
- `postgresEnv` 只返回 key 名，不返回连接串。
- `sqliteConfigured` 只表示是否读到非空 `NNZ_DB_PATH`。
- 用户端 H5 / 微信端不能展示这些机制字段；它只用于健康检查和部署排障。

启动日志也会输出当前持久化模式：

```text
Postgres persistence configured via DATABASE_URL.
SQLite persistence configured via NNZ_DB_PATH.
No persistent store configured; using in-memory demo store.
```

## 本地验证记录

本地 iCloud/Obsidian 路径仍有已知原生依赖问题：

```text
better-sqlite3.node: incompatible architecture (have 'x86_64', need 'arm64e' or 'arm64')
```

可靠验证仍使用 `/tmp` 干净副本：

```bash
tmpdir=$(mktemp -d /tmp/nnz-healthz-verify.XXXXXX)
git archive --format=tar HEAD | tar -x -C "$tmpdir"
git diff --binary > "$tmpdir/worktree.patch"
cd "$tmpdir"
git apply worktree.patch
cd nnz-mvp
npm ci
npm run typecheck
npm test
npm run build:demo
npm audit
```

2026-06-11 结果：

```text
typecheck passed
9 test files passed
64 tests passed
build:demo passed
npm audit: 0 vulnerabilities
```

本地无持久化 smoke：

```text
HOST=127.0.0.1 PORT=3031 NNZ_DB_PATH='   ' NNZ_POSTGRES_URL='   ' DATABASE_URL='   ' node dist-cjs/demo-server.js

/healthz:
persistence.mode = "in-memory"
persistence.postgresConfigured = false
persistence.postgresEnv = null
persistence.sqliteConfigured = false
```

## 官方依据

Render 官方文档说明：

- Environment variables 用于给服务注入运行时配置和 secret，不应提交到代码仓库。
- Render Postgres 同区服务推荐优先使用 Internal URL；External URL 主要用于 Render 外部连接。

参考：

```text
https://render.com/docs/configure-environment-variables
https://render.com/docs/postgresql-creating-connecting
```

## 下一步操作

Postgres 接入已经完成。下一步建议：

1. 增加后台测试数据清理能力，避免 smoke 用户长期堆积。
2. 把云端 Postgres snapshot persistence 继续演进成逐表 repository，但不能绕开 `userId + personaId` 作用域。
3. 如果要从 External URL 切回 Render Internal URL，先在环境变量页覆盖 `DATABASE_URL`，再验证 `/healthz` 和重启后数据恢复 smoke。
4. 继续拆分 Soul Ops Console：RBAC、audit log、数据删除流水。

## 不要做的事

- 不要把数据库连接串写入仓库。
- 不要把连接串贴进普通文档。
- 不要为了共享数据库而放宽 `userId + personaId` 作用域。
- 不要把 `/demo` 或 `/healthz` 的机制字段展示到用户端 H5 / 微信端。
- 不要升级 Free Postgres 或创建付费资源，除非用户明确授权。
