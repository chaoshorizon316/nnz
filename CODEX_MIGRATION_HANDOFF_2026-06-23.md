# Codex 迁移交接包 2026-06-23

> 目的：当前 Codex 旧对话绑定的工作目录已经不存在。用户会把 Codex / Obsidian / GitHub Desktop 都迁移到新的唯一主库。新对话开始后，请先读本文件，再继续工作。

## 1. 当前唯一主库

请使用这个路径作为所有后续工作的根目录：

```text
/Users/will/Library/Mobile Documents/iCloud~md~obsidian/Documents/黑曜石知识库 2/Personal/我还在
```

不要再使用旧路径：

```text
/Users/will/Library/Mobile Documents/iCloud~md~obsidian/Documents/黑曜石知识库/Personal/我还在
```

原因：旧路径已不存在，Codex App 当前旧项目仍绑定它，因此会提示「当前工作目录缺失，此对话的工作目录已不存在」。

## 2. iCloud 目录整理状态

截至 2026-06-23 11:27，iCloud Obsidian Documents 下有：

```text
黑曜石知识库 2                 当前主库，后续唯一使用
黑曜石知识库-残缺归档-20260623  旧残缺副本归档，不再使用
黑曜石知识库 3-旧归档-20260623  旧完整副本归档，不再使用
```

之前的状态是：

- `黑曜石知识库`：残缺副本，`.git` 不完整，Git 不认为它是仓库。
- `黑曜石知识库 2`：最新完整副本，包含 2026-06-22 / 2026-06-23 的最新代码和知识库记录。
- `黑曜石知识库 3`：2026-06-04 左右的旧完整副本，曾显示 `ahead 2`，但内容明显落后当前主线。

## 3. Codex / GitHub Desktop / Obsidian 操作提示

迁移后应在 Codex 中重新打开项目：

```text
/Users/will/Library/Mobile Documents/iCloud~md~obsidian/Documents/黑曜石知识库 2/Personal/我还在
```

GitHub Desktop 也应重新 Add Existing Repository 到同一路径。

Obsidian 应打开 `黑曜石知识库 2` 这份 vault，避免继续写入旧归档目录。

旧 Codex 对话可以读取历史，但它自己的 cwd 元数据已经坏了；后续开发应在新 Codex 对话中进行。

## 4. 当前 Git 状态

当前仓库：

```text
branch: main
remote: origin https://github.com/chaoshorizon316/nnz.git
HEAD: 560520f fix: revert index.html to stable version before modal
status: main...origin/main
```

当前本地有未提交改动：

```text
 M CLAUDE_CODE_HANDOFF.md
 M nnz-mvp-CURRENT-STATE.md
 M nnz-mvp/CLAUDE_CODE_HANDOFF.md
 M nnz-mvp/public/index.html
?? nnz-mvp-2026-06-22-H5体验弹窗与CTA修复记录.md
?? nnz-mvp-2026-06-22-线上与工作区核查记录.md
?? nnz-mvp-2026-06-23-H5创建体验选项交互优化.md
?? CODEX_MIGRATION_HANDOFF_2026-06-23.md
```

注意：本交接包本身也是新增未提交文件。

## 5. 已完成的产品代码改动

主要代码文件：

```text
nnz-mvp/public/index.html
```

已完成：

- 首页导航和 CTA 从滚动到 `#demo` 改为调用 `openExperience(event)` 打开 H5 在线体验 modal。
- `#demo` 从页面内嵌区改为唯一 modal overlay，避免重复 id 和跳转混乱。
- 新增 modal 打开/关闭、ESC 关闭、点击遮罩关闭、焦点返回。
- 修复 H5 JS 历史断点：
  - `h5RenderConversation()` 三元表达式被误插入 `h5RefreshCovenantState()` 的问题。
  - 补齐 `h5AuthHeaders()`。
  - `h5CovenantAction()` 从不存在的 `h5LoadChatHistory()` 改为 `h5LoadConversation()`。
- 修复 modal 初始可见问题：
  - `#demo` 加 `hidden`。
  - `.nnz-experience-modal[hidden] { display: none !important; }`。
  - `openExperience()` / `closeExperience()` 同步维护 `hidden` 和 `display`。
- 「创建你想念的人」Page 1 改为左右结构：
  - 左侧输入称呼、关系、口头禅。
  - 右侧常用称呼快速选择。
  - 常用称呼从 `span` 改为 `button`。
  - 选中态更明显：实底、白字、边框、阴影。
  - 新增键盘 focus visible。
- 「勾选你记得的特征」Page 2 改为复选框式真多选：
  - 从 `trait-chip` 改为 `trait-check`。
  - 每项包含 checkbox、标签、描述。
  - 选中后有勾选框、浅绿色底、边框、内阴影。
  - 同一组内可多选，取消一项不会清掉其他项。
- 创建人格描述会保留全部多选特征。
- 提交给后端的 `traits` 仍保持当前 `Record<string,string>` 兼容形态，避免影响 `humorLevel` 等既有后端逻辑。

关键代码定位：

```text
nnz-mvp/public/index.html
  modal / H5 CSS: 约 11-229 行
  H5 创建 Page 1/2 markup: 约 388-406 行
  openExperience / closeExperience: 约 1307 行
  h5InitQuickNames: 约 1510 行
  h5InitTraits: 约 1522 行
  h5ToggleTrait: 约 1541 行
  traitsPayload: 约 1586 行
```

## 6. 已写入知识库的记录

新增或更新：

```text
nnz-mvp-2026-06-22-线上与工作区核查记录.md
nnz-mvp-2026-06-22-H5体验弹窗与CTA修复记录.md
nnz-mvp-2026-06-23-H5创建体验选项交互优化.md
nnz-mvp-CURRENT-STATE.md
CLAUDE_CODE_HANDOFF.md
nnz-mvp/CLAUDE_CODE_HANDOFF.md
CODEX_MIGRATION_HANDOFF_2026-06-23.md
```

用户明确要求：每日关键进展和成果都要沉淀到本地 Obsidian 知识库中。后续继续保持这个习惯。

## 7. 已完成验证

在主库 `黑曜石知识库 2/Personal/我还在/nnz-mvp` 中通过：

```text
npm ci
npm run typecheck
npm test
npm run build:demo
npm audit
git diff --check
node inline script / DOM smoke
H5 multi-select behavior smoke
dist-cjs/public smoke
本地 demo /healthz smoke
```

最近一次全量测试：

```text
12 test files passed
79 tests passed
```

注意：普通沙箱下 `npm test` / `npm run build:demo` 可能因写入 `node_modules/.vite-temp` 或 `dist-cjs` 出现 EPERM。需要用项目写权限/用户批准后重跑。

## 8. 本地预览服务状态

上一轮曾启动本地服务：

```text
http://127.0.0.1:3007
```

由于当前环境变量里曾有无效 `NNZ_DB_PATH=/Users/will/Documents/nnz-backup/nnz.db`，第一次启动失败。随后用：

```text
NNZ_DB_PATH=/tmp/nnz-h5-ui-local.db npm run dev
```

启动成功，并通过 healthz / 首页 HTML smoke。

该服务后来已用 Ctrl-C 停止。

## 9. 线上状态

线上 Render 地址：

```text
https://nnz-kego.onrender.com
```

截至这些本地修改完成时：

- 线上仍是 GitHub `main` 最新已部署版本附近，HEAD 参考为 `560520f fix: revert index.html to stable version before modal`。
- 本地 H5 modal / CTA / 创建体验优化尚未提交、推送、部署。
- 因此线上还看不到 2026-06-22 / 2026-06-23 的本地修复。

后续上线需要：

```text
1. 在新 Codex 项目中确认工作区路径正确。
2. 查看 git diff。
3. 重新跑 typecheck / test / build:demo / audit。
4. 提交 commit。
5. push 到 GitHub。
6. 等 GitHub Actions / Render 部署完成。
7. 做线上 smoke：/healthz、首页 CTA、modal 初始隐藏、创建体验 Page 1/2。
```

## 10. 下一个 Codex 对话的第一步建议

新对话开始后，请先执行：

```bash
pwd
git status -sb
git diff --stat
```

确认路径必须是：

```text
/Users/will/Library/Mobile Documents/iCloud~md~obsidian/Documents/黑曜石知识库 2/Personal/我还在
```

然后继续做：

```text
1. 检查本交接包。
2. 检查当前未提交 diff。
3. 若用户同意，提交并推送 H5 修复与文档。
4. 推送后做线上验收。
```

## 11. 用户偏好与重要约定

- 用户希望目标、进度、计划都沉淀在本地 Obsidian 知识库。
- 用户希望做“干净修复”，避免环境脏状态造成假问题。
- 不要删除旧归档目录，除非用户明确确认。
- 不要再把任何内容写到无后缀旧路径。
- 代码修改前先确认当前 cwd。
- 若涉及线上/最新状态，必须实际核查，不要凭记忆判断。
