# Claude Code Entry: 念念在

如果你是 Claude Code / 其他 AI / 开发者，从这个知识库根目录接手，请先进入当前 MVP 子项目：

```bash
cd "/Users/will/Library/Mobile Documents/iCloud~md~obsidian/Documents/黑曜石知识库/Personal/我还在/nnz-mvp"
```

详细交接文档在：

```text
nnz-mvp/CLAUDE_CODE_HANDOFF.md
```

请优先阅读那份文档。它包含完整的产品意图、Soul 作用域规则、代码结构、环境搭建、运行命令、API 验证、测试覆盖、已知边界和后续计划。

后台治理与 Soul 成熟度架构补充在：

```text
念念在-产品与技术架构：后台治理与Soul成熟度.md
```

这份文档说明了为什么用户端应对 LLM / 封存 / Proposal / Snapshot 等机制无感，而后台需要建设 `Soul Ops Console` 来管理用户、Persona、Memory、Soul 成熟度、风险和迭代策略。

Step 4.5 的实现记录在：

```text
nnz-mvp-Step4.5-SoulOps后台治理实施记录.md
```

这份文档记录了已改文件、验证方式、API 结果、页面确认和下一步 Step 4.6 建议。

## 当前最重要目标

当前 MVP 验证的是：

> 不同用户拥有不同 Soul。

当前 `nnz-mvp` 还已完成阶段一 Covenant 生命周期收口：

```text
ACTIVE -> SEALED -> NODE -> SEALED -> GRADUATED
```

最新状态、验证方式和注意事项以 `nnz-mvp/CLAUDE_CODE_HANDOFF.md` 为准。

截至当前，步骤二 Memory Vault 分层的基础字段与筛选规则也已落地：Runtime 记忆和 Soul Update 证据分开处理，`RISK` / `RESTRICTED` / `NODE_MEMORY` 不会误用于 Soul 更新。

步骤三 SoulUpdateProposal 审核流程基础版也已落地：提案可列表化、可查看证据、可接受、可拒绝，并通过 fieldPath 白名单限制可更新的 Soul Kernel 字段。Demo 已展示 `oldValue -> newValue`，且 `ACCEPTED` / `REJECTED` 为终态；拒绝后可生成新的独立 `PENDING` 提案。

Soul 的唯一作用域是：

```ts
userId + personaId
```

不要建立全局 `DeceasedSoul`，不要只按 `personaId` 取 Soul，不要把 A 用户的记忆、纠正、节点事件、聊天内容用于 B 用户。

## 快速运行

```bash
cd "/Users/will/Library/Mobile Documents/iCloud~md~obsidian/Documents/黑曜石知识库/Personal/我还在/nnz-mvp"
npm install
npm run typecheck
npm test
npm run demo
```

Demo 地址：

```text
http://127.0.0.1:3007
```

## 当前关键文件

```text
nnz-mvp/src/domain/soul-store.ts
nnz-mvp/src/domain/types.ts
nnz-mvp/src/domain/soul-scope.test.ts
nnz-mvp/src/runtime/soul-runtime.ts
nnz-mvp/src/runtime/soul-runtime.test.ts
nnz-mvp/src/demo-server.ts
nnz-mvp/CLAUDE_CODE_HANDOFF.md
nnz-mvp-Step4.5-SoulOps后台治理实施记录.md
念念在-产品与技术架构：后台治理与Soul成熟度.md
```

## 不要破坏的边界

- 所有 Soul / Memory / Snapshot / Node / Conversation 查询必须带 `userId + personaId`。
- A 用户的纠正不能更新 B 用户的 Soul。
- A 用户的节点记忆不能出现在 B 用户检索或聊天里。
- 删除 A 用户数据不能删除 B 用户数据。
- 人物前台回复不能直接说后台机制，例如 `userId`、`personaId`、`节点里的`、`不是我本来就知道`、`按你的记忆`、`检索`、`证据`。

更多细节请看：

```bash
open "nnz-mvp/CLAUDE_CODE_HANDOFF.md"
```
