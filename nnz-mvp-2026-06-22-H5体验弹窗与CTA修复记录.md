# nnz-mvp 2026-06-22：H5 体验弹窗与 CTA 修复记录

## Summary

本次目标：接手另一位 AI 未完成的首页 H5 / modal / CTA 问题，让首页「开始创建 / 在线体验」重新打开稳定可用的 H5 体验弹窗，而不是只滚动到页面内嵌区域。

结论：

- 已在 `nnz-mvp/public/index.html` 完成修复。
- CTA 已从 `scrollIntoView(#demo)` 改为 `openExperience(event)`。
- 原唯一 H5 体验区被改造成 modal 内容，没有复制 DOM，因此不会产生重复 id / 事件绑定错位。
- 真实 Chrome 可视检查发现初版 modal 在页面加载后可能初始可见；已追加 `hidden` 属性、`[hidden]` CSS guard、以及 JS 中 `modal.hidden` / `modal.style.display` 双保险。
- 修复了 H5 脚本中的 3 个遗留断点：
  - `h5RenderConversation()` 中被插入到三元表达式中间的 `h5RefreshCovenantState()`。
  - `h5AuthHeaders()` 被调用但不存在。
  - `h5CovenantAction()` 调用不存在的 `h5LoadChatHistory()`。
- `npm ci` 已按 lockfile 干净重装依赖，`better-sqlite3` 已确认是本机 `arm64`。
- 本地 `typecheck`、全量 `npm test`、`build:demo` 均通过。

## Context

线上最新 `main` 在本次接手前为：

```text
560520f fix: revert index.html to stable version before modal
```

另一位 AI 在 2026-06-18 到 2026-06-21 期间主要围绕 `nnz-mvp/public/index.html` 反复做 H5 modal / CTA / 三步创建体验，最终回退到 modal 前稳定版。

本次接手时首页状态：

- `#demo` 是内嵌 H5 体验区。
- 首页 CTA 调用 `document.getElementById('demo').scrollIntoView({behavior:'smooth'})`。
- 文件中不存在 `openExperience()`。
- 页面底部还保留旧的付款/微信流程 `flowOverlay`，但主 CTA 不再触发它。
- H5 创建/对话脚本存在上述 3 个断点。

## Changes

修改文件：

```text
nnz-mvp/public/index.html
```

主要改动：

1. 新增 H5 体验 modal 样式：
   - `.nnz-experience-modal`
   - `.nnz-experience-panel`
   - `.nnz-experience-header`
   - `.nnz-experience-close`
   - `body.nnz-modal-open`

2. 将原 `section#demo` 改成 modal overlay：
   - 默认隐藏。
   - 默认带 `hidden` 属性，并用 `.nnz-experience-modal[hidden] { display: none !important; }` 做 CSS 双保险。
   - 打开时添加 `is-open`。
   - 打开时同步 `modal.hidden = false` 和 `modal.style.display = 'block'`。
   - 设置 `aria-hidden="false"`。
   - 支持点击遮罩关闭。
   - 支持关闭按钮。
   - 关闭时同步 `modal.hidden = true` 和 `modal.style.display = 'none'`。
   - 移动端全屏显示，避免横向溢出。

3. 新增体验弹窗控制函数：

```js
openExperience(event)
closeExperience()
```

行为：

- CTA 点击时阻止默认跳转。
- 锁定 body 滚动。
- 打开后聚焦到当前可见的 H5 输入控件。
- 关闭后恢复 body 滚动，并把焦点还给触发按钮。
- `Escape` 可关闭弹窗。

4. CTA 调整：

- 导航「在线体验」。
- 导航「开始创建」。
- Hero 首屏「开始创建」。
- 使用流程区域「开始创建」。

全部改为调用：

```html
onclick="openExperience(event)"
```

5. H5 脚本修复：

- `h5RenderConversation()` 正常设置副标题后再刷新 Covenant 状态。
- 新增 `h5AuthHeaders()`。
- `h5CovenantAction()` 成功后改为调用已存在的 `h5LoadConversation()`。

## Verification

### Script Syntax

命令：

```bash
node -e 'const fs=require("fs"); const html=fs.readFileSync("nnz-mvp/public/index.html","utf8"); const scripts=[...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m=>m[1]).join("\n"); new Function(scripts); console.log("script-ok");'
```

结果：

```text
script-ok
```

### Clean npm Install

命令：

```bash
cd nnz-mvp
npm ci
```

结果：

```text
added 121 packages
found 0 vulnerabilities
```

### Native Package Architecture

命令：

```bash
node -p 'process.version + " " + process.arch + " " + process.platform'
file node_modules/better-sqlite3/build/Release/better_sqlite3.node
```

结果：

```text
v25.6.1 arm64 darwin
Mach-O 64-bit bundle arm64
```

判断：此前 iCloud 工作区里 `better-sqlite3` x86_64 / arm64 不匹配问题已通过干净依赖重装解决。

### Typecheck

命令：

```bash
npm run typecheck
```

结果：通过。

### Tests

命令：

```bash
npm test
```

结果：

```text
Test Files  12 passed (12)
Tests       79 passed (79)
```

### Demo Build

命令：

```bash
npm run build:demo
```

结果：通过。

### Local Demo Health

启动：

```bash
PORT=3062 HOST=127.0.0.1 NNZ_DB_PATH=/tmp/nnz-h5-smoke.db node dist-cjs/demo-server.js
```

健康检查：

```bash
curl -sS http://127.0.0.1:3062/healthz
```

结果：

```json
{
  "ok": true,
  "service": "nnz-mvp-demo",
  "fixture": "sqlite",
  "persistence": {
    "mode": "sqlite",
    "postgresConfigured": false,
    "postgresEnv": null,
    "sqliteConfigured": true
  }
}
```

### Modal Behavior Smoke

由于当前环境的 Playwright CLI 缺少 `chrome-for-testing` 浏览器内核，执行真实浏览器点击前需要下载约 170.8 MiB 浏览器包；下载过程较慢，下载到约 20% 后中止，避免长期占用会话。

随后使用本机 Chrome 访问 `http://127.0.0.1:3062` 做可视检查，发现初版 modal 在页面加载后可能初始可见。已据此补上 `hidden` / `[hidden]` / inline display 三重保护，并重新验证。

覆盖：

- `section#demo` 初始带 `hidden`。
- `.nnz-experience-modal[hidden]` 强制隐藏。
- `openExperience(event)` 添加 `is-open`。
- `openExperience(event)` 清除 `hidden` 并设置 `display:block`。
- `aria-hidden` 从 `true` 变为 `false`。
- body 添加 `nnz-modal-open`。
- `closeExperience()` 移除 `is-open`。
- `closeExperience()` 恢复 `hidden` 并设置 `display:none`。
- `aria-hidden` 恢复为 `true`。
- body 移除 `nnz-modal-open`。

结果：

```text
modal-hidden-smoke-ok
```

## Notes

- 本次没有改动 Soul / Memory / Snapshot / Node / Conversation 的作用域模型。
- 本次没有改动 Soul Ops token、RBAC、审计日志、删除回执或云端 Postgres 配置。
- 用户端仍不暴露 `userId`、`personaId`、`SoulVersion`、`MemoryItem`、`SoulUpdateProposal` 等后台机制词。
- 2026-06-23 已通过提交 `5e0df09 fix: restore h5 experience modal` 推送到 GitHub `main`，GitHub Actions run `28012032867` success，Render 首页已返回 modal 版本。

## Next Steps

1. H5 修复已提交、推送并完成线上 smoke。
2. 若后续继续改 H5，先以线上 `5e0df09` 为稳定基线。
3. 工程主线继续回到 Step 2.5：Postgres scoped repository 设计与最小落地。
