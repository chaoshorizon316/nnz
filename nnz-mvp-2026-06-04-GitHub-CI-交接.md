# nnz-mvp 2026-06-04 GitHub / CI 交接

> 目的：让 Claude Code / 其他 AI / 开发者快速理解今天完成了什么、GitHub 仓库状态是什么、还需要做什么。

## 当前结论

念念在本地知识库已经接入 GitHub 仓库：

```text
https://github.com/chaoshorizon316/nnz
```

本地仓库路径：

```text
/Users/will/Library/Mobile Documents/iCloud~md~obsidian/Documents/黑曜石知识库/Personal/我还在
```

远端分支：

```text
origin/main
```

## 今日完成

### 1. 初始化 GitHub 仓库内容

已将知识库根目录初始化为 Git 仓库，并接入远端：

```bash
git remote -v
# origin https://github.com/chaoshorizon316/nnz.git
```

远端最初只有占位 README：

```text
cf11d53 Create README.md
```

之后提交了完整项目工作区：

```text
74981e0 chore: initialize nnz mvp workspace
```

该提交已由用户通过 GitHub Desktop 推送成功。远端 `main` 已确认指向 `74981e0`。

### 2. 仓库内容整理

新增 / 提交的关键内容：

- 根 README：说明项目定位、Soul 作用域第一原则、仓库地图、验证命令。
- `.gitignore`：排除 `node_modules/`、`dist/`、`dist-cjs/`、`.DS_Store`、`.env`、密钥等。
- `index.html` / `styles.css`：当前 H5 产品原型。
- `nnz-mvp/`：TypeScript MVP 代码、测试、demo server。
- `.agents/skills/`：项目专用 AI 协作规则。
- 根目录各产品 / 架构 / 实施记录文档。

明确未提交：

- `nnz-mvp/node_modules/`
- `nnz-mvp/dist/`
- `nnz-mvp/dist-cjs/`
- `.DS_Store`
- `.env` / key / secret 文件

### 3. 修复工程可复现性

处理过的问题：

- `vitest` 旧版本有 critical audit 风险，升级到 `vitest@4.1.8`。
- `tsconfig.demo.json` 继承基础配置后缺少 Node 类型，已补：

```json
"types": ["node"]
```

- 在 iCloud / Obsidian 目录下，`node_modules` 偶发出现包内容不完整，比如 `tinyglobby/dist/index.mjs` 缺失。已确认这是本地同步目录的依赖落盘问题，不是源码问题。干净 `/tmp` 副本用 `npm ci` 可以稳定通过。

### 4. 新增 GitHub Actions CI

本地已新增提交：

```text
a1d4fbb ci: verify nnz mvp
```

新增文件：

```text
.github/workflows/nnz-mvp-ci.yml
```

CI 触发：

- push 到 `main`
- pull_request 到 `main`

CI 执行目录：

```text
nnz-mvp
```

CI 命令：

```bash
npm ci
npm run typecheck
npm test
npm run build:demo
npm audit
```

Node 版本：

```text
22
```

原因：`vitest@4.1.8` / `vite` 依赖链要求 Node `^20.19.0 || >=22.12.0`，GitHub Actions 用 Node 22 更稳。

## 当前 Git 状态

截至本文档初稿生成时，本地状态是：

```text
main...origin/main [ahead 1]
```

也就是说当时：

- `74981e0 chore: initialize nnz mvp workspace` 已推送到 GitHub。
- `a1d4fbb ci: verify nnz mvp` 是本地提交，尚未推送。

注意：如果本文档也已经被提交，但还没推送，那么本地可能显示 `ahead 2` 或更多。判断标准永远以当前命令为准：

```bash
git status --short --branch
git log --oneline --decorate -5
```

需要用户用 GitHub Desktop 再点一次：

```text
Push origin
```

或者在终端认证后执行：

```bash
git push -u origin main
```

命令行推送方法：

```bash
git remote set-url origin "https://github.com/chaoshorizon316/nnz.git"
git push origin main
```

优先使用 GitHub Desktop、系统 credential helper、或已经认证过的终端环境。不要把 PAT 写进 remote URL、提交文件或工作记录。

历史踩坑：2026-06-04 曾用 PAT remote URL 方式排查推送问题，后来 GitHub 会拦截明文 token，且 token 可能残留在日志中。若 token 曾暴露，应去 https://github.com/settings/tokens 撤销旧 token。

## 验证记录

在 `nnz-mvp` 本地依赖完整时，以下命令通过：

```bash
npm run typecheck
npm test
npm run build:demo
npm audit
```

测试结果：

```text
Test Files  3 passed
Tests       37 passed
```

干净副本验证也通过：

```bash
tmpdir=$(mktemp -d /tmp/nnz-ci-verify.XXXXXX)
git archive --format=tar HEAD | tar -x -C "$tmpdir"
cp -R .github "$tmpdir"/
cd "$tmpdir/nnz-mvp"
npm ci
npm run typecheck
npm test
npm run build:demo
npm audit
```

结论：CI 文件和源码在干净环境可复现。

## 给下一位 AI 的操作顺序

### 先做状态确认

```bash
cd "/Users/will/Library/Mobile Documents/iCloud~md~obsidian/Documents/黑曜石知识库/Personal/我还在"
git status --short --branch
git log --oneline --decorate -5
git remote -v
```

如果看到：

```text
main...origin/main [ahead 1]
```

说明 CI 提交还没推送。若看到 `ahead 2` 或更多，通常表示 CI 提交和本文档沉淀提交都还没推送。不要重复创建 CI 文件，直接提醒用户用 GitHub Desktop 推送。

### 推送后确认远端

```bash
git ls-remote https://github.com/chaoshorizon316/nnz.git refs/heads/main
```

目标是看到远端 `main` 指向：

```text
a1d4fbb...
```

然后查看 GitHub Actions：

```text
https://github.com/chaoshorizon316/nnz/actions
```

CI 应自动运行 `NNZ MVP CI`。

### 本地验证

如果当前 iCloud 目录里的 `node_modules` 报缺文件，不要先改源码。优先尝试：

```bash
cd nnz-mvp
npm install
```

如果只缺某个包，例如 `tinyglobby`：

```bash
rm -rf node_modules/tinyglobby
npm install
```

更可靠的验证方式是复制到 `/tmp` 后运行 `npm ci`，避开 iCloud 同步目录对 `node_modules` 的影响。

## 下一步计划建议

### Step A：确认 CI 绿灯

用户推送 `a1d4fbb` 后，进入 GitHub Actions 页面确认：

- Workflow 已触发。
- `Install dependencies` 通过。
- `Typecheck` 通过。
- `Test` 显示 37 tests passed。
- `Build demo` 通过。
- `Audit dependencies` 显示 0 vulnerabilities。

若 CI 失败，优先根据 Actions log 修复，不要凭本地 iCloud 目录状态判断。

### Step B：建立云端 demo 环境

CI 通过后，再部署 demo server。候选：

- Render：最省心，适合 Node HTTP demo。
- Railway：也适合快速 demo，但长期成本要看资源。
- Fly.io：更工程化，但配置略多。

当前 demo 启动命令：

```bash
cd nnz-mvp
npm ci
npm run demo
```

`demo` 实际执行：

```bash
npm run build:demo && node dist-cjs/demo-server.js
```

注意：云环境通常要求监听 `process.env.PORT`。如果 `demo-server.ts` 现在固定端口，需要先改成：

```ts
const port = Number(process.env.PORT ?? 3007);
```

部署前还应确认：

- demo 不保存真实用户数据。
- demo 页面不暴露密钥。
- user-facing 文案不出现机制词。
- admin / Soul Ops 内容只作为后台演示，不混入用户端。

### Step C：下一轮产品技术推进

在 CI / 云 demo 稳定后，建议按以下顺序继续：

1. 接真实 LLM adapter，但保留 `generateSoulReply` 的输入输出边界。
2. 做 Memory 自动化提取管线：conversation -> structured extraction -> memory/proposal。
3. 抽取 store interface，准备 SQLite 持久化。
4. 将 Soul Ops Console 从 demo 页面升级为独立后台模块。
5. 增加端到端验证：双用户同名 persona、纠正隔离、节点隔离、删除隔离、安全护栏。

## 最高优先级边界

任何后续 AI 都必须遵守：

```text
Soul scope = userId + personaId
```

禁止：

- 全局 `DeceasedSoul`
- 只按 `personaId` 查询 Soul
- 跨用户聚合人格
- A 用户纠正影响 B 用户
- A 用户节点记忆进入 B 用户上下文
- 删除 A 用户数据影响 B 用户
- 用户端暴露 `SoulVersion` / `SoulSnapshot` / `SoulUpdateProposal` / `MemoryItem` / `scope` / `retrieval` / `evidence`

家庭共创不是 MVP。未来如支持，必须做成独立的 `Shared Memorial Space`，并且显式邀请、授权、可撤回，不覆盖个人 Soul。
