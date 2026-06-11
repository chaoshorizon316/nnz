# nnz-mvp 2026-06-11 Render Postgres 排查记录

> 目标：确认云端 demo 为什么仍是 `fixture: "in-memory"`，并给下一位 AI 或 Claude Code 留下可继续执行的最短路径。

## 结论

代码侧 Postgres snapshot persistence 已经合入并通过 CI，但 Render 当前运行中的 Web Service 还没有配置数据库连接变量。

当前线上健康检查：

```text
https://nnz-kego.onrender.com/healthz
fixture: "in-memory"
```

## Render 控制台核查

检查对象：

```text
Web Service: nnz
Service ID: srv-d8go7pmq1p3s739r12jg
URL: https://nnz-kego.onrender.com
Repo: chaoshorizon316/nnz
Branch: main
Root Directory: nnz-mvp
Auto Deploy: On Commit
```

服务级 Environment 页面：

```text
https://dashboard.render.com/web/srv-d8go7pmq1p3s739r12jg/env
```

只读核查 key 名，不读取 secret value。当前存在的 key：

```text
NNZ_LLM_API_KEY
NNZ_LLM_BASE_URL
NNZ_LLM_MODEL
```

未发现：

```text
DATABASE_URL
NNZ_POSTGRES_URL
```

项目级 Environment 页面：

```text
https://dashboard.render.com/project/prj-d8go7pf7f7vs73f1061g/environment/evm-d8go7pf7f7vs73f10620
```

结果：

```text
Services: 1
Env Groups: 0
```

因此不是“变量在 Env Group 里但没有生效”，而是当前 Web Service 运行环境没有数据库连接变量。

## 代码增强

2026-06-11 已给 `/healthz` 增加不泄露密钥的诊断字段：

```json
{
  "ok": true,
  "service": "nnz-mvp-demo",
  "fixture": "in-memory",
  "persistence": {
    "mode": "in-memory",
    "postgresConfigured": false,
    "postgresEnv": null,
    "sqliteConfigured": false
  }
}
```

说明：

- `postgresConfigured` 只表示是否读到非空 `NNZ_POSTGRES_URL` 或 `DATABASE_URL`。
- `postgresEnv` 只返回 key 名，不返回连接串。
- `sqliteConfigured` 只表示是否读到非空 `NNZ_DB_PATH`。
- 用户端页面不会展示这些字段；它只用于健康检查和部署排障。

启动日志也会输出当前持久化模式：

```text
Postgres persistence configured via DATABASE_URL.
SQLite persistence configured via NNZ_DB_PATH.
No persistent store configured; using in-memory demo store.
```

## 验证记录

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
- Render Postgres 同区服务应优先使用 Internal URL；External URL 主要用于 Render 外部连接。

参考：

```text
https://render.com/docs/configure-environment-variables
https://render.com/docs/postgresql-creating-connecting
```

## 下一步操作

需要用户或有 Render 权限的人完成以下步骤：

1. 在 Render 创建 Postgres 或确认已有兼容数据库。
2. 数据库与 Web Service 最好同账号、同 region；当前 Web Service region 是 Ohio。
3. 从数据库 Connect / Info 页面复制 Internal Database URL。
4. 到 Web Service `nnz` 的 Environment 页面添加：

```text
DATABASE_URL=<Internal Database URL>
```

也可以使用：

```text
NNZ_POSTGRES_URL=<Internal Database URL>
```

5. 保存时选择 deploy/redeploy，或手动触发 Manual Deploy。
6. 验证：

```text
/healthz fixture === "postgres"
/healthz persistence.postgresConfigured === true
/healthz persistence.postgresEnv === "DATABASE_URL" 或 "NNZ_POSTGRES_URL"
```

7. 做持久化验收：

```text
注册用户 -> 创建“爸爸” -> 发送一句话 -> 手动 redeploy -> 登录同一账号 -> persona 和聊天记录仍可取回
```

## 不要做的事

- 不要把数据库连接串写入仓库。
- 不要把连接串贴进普通文档。
- 不要为了共享数据库而放宽 `userId + personaId` 作用域。
- 不要把 `/demo` 或 `/healthz` 的机制字段展示到用户端 H5 / 微信端。
- 不要擅自创建可能产生费用的 Render 资源，除非用户明确授权。
