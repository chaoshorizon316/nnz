# nnz-mvp 2026-06-04 云端 Demo 部署交接

> 目的：把当前本地 demo 发布成可公开访问的协作验证链接。该部署只用于 MVP 演示，不承载真实用户数据。



## 已部署

Render URL：

```text
https://nnz-kego.onrender.com
```

部署日期：2026-06-04

创建方式：Web Service（手动配置），Root=nnz-mvp，Build=npm ci && npm run build:demo，Start=npm run start

## 部署目标

生成一个公网 URL，用于验证：

- 双用户同名“爸爸”对应两个独立 Soul。
- 用户 A 的纠正提案不影响用户 B。
- 用户 A 的节点记忆不进入用户 B 上下文。
- Soul Ops 后台视图可观察成熟度、提案、状态和风险。
- 用户端回复不泄露 `SoulVersion`、`MemoryItem`、`scope`、`evidence` 等机制词。

## 当前部署选择

推荐使用 Render Web Service。

原因：

- 当前 demo 是标准 Node HTTP 服务。
- 不需要数据库。
- 不需要真实 LLM Key。
- Render 可直接读取仓库根目录的 `render.yaml`。
- GitHub push 后可自动部署，适合快速给另一个 AI / 协作者验证。

GitHub 仓库：

```text
https://github.com/chaoshorizon316/nnz
```

Render Blueprint 文件：

```text
render.yaml
```

## 已完成的云端适配

### 1. Server host 适配

`nnz-mvp/src/demo-server.ts` 已从只监听本机：

```ts
server.listen(port, '127.0.0.1', ...)
```

改为默认监听云端可访问地址：

```ts
const port = Number(process.env.PORT ?? 3007);
const host = process.env.HOST ?? '0.0.0.0';
server.listen(port, host, () => {
  const displayHost = host === '0.0.0.0' ? '127.0.0.1' : host;
  console.log(`念念在 Soul 作用域演示已启动: http://${displayHost}:${port}`);
});
```

本地仍可访问：

```text
http://127.0.0.1:3007
```

### 2. npm start

`nnz-mvp/package.json` 已新增：

```json
"start": "node dist-cjs/demo-server.js"
```

云端构建后直接运行：

```bash
npm run start
```

### 3. Node 版本

`nnz-mvp/package.json` 已约束：

```json
"engines": {
  "node": ">=22.12.0 <26"
}
```

原因：当前 `vitest@4.1.8` / `vite` 依赖链要求 Node `^20.19.0 || >=22.12.0`；云端使用 Node 22，本机 Node 25 也可继续验证。

### 4. Render Blueprint

仓库根目录新增：

```yaml
services:
  - type: web
    name: nnz-mvp-demo
    runtime: node
    plan: free
    rootDir: nnz-mvp
    buildCommand: npm ci && npm run build:demo
    startCommand: npm run start
    autoDeployTrigger: checksPass
    healthCheckPath: /healthz
    envVars:
      - key: NODE_VERSION
        value: 22
      - key: NODE_ENV
        value: production
```

## Render 创建步骤

1. 登录 Render：

```text
https://render.com
```

2. 使用 GitHub 登录或连接 GitHub。

3. 选择仓库：

```text
chaoshorizon316/nnz
```

4. 推荐使用 Blueprint：

```text
New -> Blueprint -> 选择 chaoshorizon316/nnz
```

Render 应自动识别根目录的：

```text
render.yaml
```

5. 创建服务后等待首次部署。

6. 记录生成的 URL，例如：

```text
https://nnz-mvp-demo.onrender.com
```

实际 URL 以 Render 控制台为准。

## 部署后验收清单

打开 Render URL 后检查：

- 首页能正常加载。
- `/healthz` 返回 `{ "ok": true }`。
- `GET /api/state` 返回 JSON。
- 页面初始显示用户 A / 用户 B 两列。
- 点击“生成纠正提案”后，用户 A 有提案，用户 B 不变。
- 接受 / 拒绝提案只对 PENDING 提案生效，终态不能互相覆盖。
- 创建“婚礼”节点后，节点记忆只出现在用户 A。
- 聊天回复中不出现机制词，例如 `SoulVersion`、`MemoryItem`、`scope`、`evidence`、`检索`、`证据`。
- Soul Ops 后台视图只作为 demo 管理视图，不混入终端用户叙事。

也可以直接访问：

```text
/api/verification
```

该接口用于快速查看演示验证状态。

## 安全边界

当前云端 demo 是公开演示环境，必须遵守：

- 不上传真实逝者资料。
- 不输入真实用户隐私。
- 不接生产数据库。
- 不接真实微信账号。
- 不接真实支付。
- 不接真实 OpenAI / LLM Key。
- 不把 demo URL 当正式产品入口传播给真实用户。

当前 store 是内存态：

- 服务重启后数据会重置。
- 多个访问者共享同一个 demo fixture。
- `/api/reset` 会重置演示数据。

这对 MVP 演示是可接受的，但不能用于生产。

## 后续增强建议

### 短期

1. 给 demo 加简单访问口令或 Basic Auth，避免公开仓库带来的随意访问。
2. 在 README 增加 Render URL。
3. 增加 GitHub Actions 的 deployment smoke test。
4. 给 `/api/verification` 增加云端 smoke-test 脚本，部署后自动确认关键检查。

### 中期

1. 抽取 `SoulStore` interface。
2. 增加 SQLite / Postgres 持久化实现。
3. 将 Soul Ops Console 拆成独立后台入口。
4. 接 LLM adapter 和 Memory 自动提取管线。
5. 引入 RBAC / audit log / 数据删除流水。

## 下一位 AI 接手时先做什么

先确认本地与远端状态：

```bash
git status --short --branch
git log --oneline --decorate -5
```

再确认 CI：

```text
https://github.com/chaoshorizon316/nnz/actions
```

如果 Render 已创建，优先把 Render URL 写回：

- `README.md`
- `CLAUDE_CODE_HANDOFF.md`
- 本文档

如果 Render 还没创建，按本文“Render 创建步骤”继续。

## 最高优先级不变量

任何云端化、持久化、LLM 接入都不能破坏：

```text
Soul scope = userId + personaId
```

禁止跨用户共享、聚合、污染、自动合并 Soul。
