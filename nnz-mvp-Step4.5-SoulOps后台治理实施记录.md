# nnz-mvp Step 4.5：Soul Ops 后台治理 + Soul 成熟度 — 实施记录

## 1. 阶段定位

本阶段确认了一个关键产品判断：

> 用户端或微信端应对 LLM、Soul 更新、封存快照、Proposal 审核等后台机制无感；后台需要建设可观察、可审核、可迭代的 Soul Ops Console。

因此 Step 4.5 不接真实 LLM，而是先实现后台治理的最小闭环：

- 能查看用户 A / 用户 B 各自的 Soul 成熟度。
- 能看到 Memory、Proposal、Snapshot、Node、Runtime 状态。
- 能给出后台 recommendations。
- 继续严格遵守 `userId + personaId` 私有作用域。

## 2. 已完成内容

### 2.1 Domain 类型

文件：

```text
nnz-mvp/src/domain/types.ts
```

新增类型：

- `SoulMaturityLevel`
- `SoulRecommendationType`
- `SoulRecommendationPriority`
- `SoulRecommendationStatus`
- `SoulRecommendation`
- `SoulMaturityReport`

成熟度等级：

```text
L0_SEED
L1_SKETCH
L2_USABLE
L3_STABLE
L4_SEALED_READY
L5_LEGACY_READY
```

### 2.2 Store 成熟度计算

文件：

```text
nnz-mvp/src/domain/soul-store.ts
```

新增方法：

```ts
buildSoulMaturityReport(scope)
```

该方法仍然必须传入：

```ts
{ userId, personaId }
```

它只读取当前 scope 下的数据：

- SoulVersion
- MemoryItem
- SoulUpdateProposal
- SoulSnapshot
- NodeEvent
- ConversationMessage
- RuntimeSession

不会跨用户、跨 persona 聚合。

当前分项：

- `evidenceCoverage`
- `identityClarity`
- `voiceConsistency`
- `memoryReliability`
- `runtimeStability`
- `safetyReadiness`

当前 recommendations：

- `ASK_MORE_MEMORY`
- `REQUEST_CHAT_UPLOAD`
- `REVIEW_PROPOSAL`
- `REVIEW_CONFLICT`
- `SUGGEST_SEAL`
- `LIMIT_RUNTIME`
- `REVIEW_RISK`
- `READY_FOR_NODE`
- `READY_FOR_GRADUATION`

注意：当前算法是可解释启发式，不是最终心理学或机器学习评分。后续可以替换计算器，但应保留 `SoulMaturityReport` 的接口契约。

### 2.3 Demo API

文件：

```text
nnz-mvp/src/demo-server.ts
```

`/api/state` 中每个用户现在都有：

```ts
userA.ops.maturity
userB.ops.maturity
```

这让页面和外部验证脚本都能直接读取后台治理数据。

### 2.4 Demo 页面

文件：

```text
nnz-mvp/src/demo-server.ts
```

页面新增：

```text
Soul Ops Console
```

展示内容：

- 用户 A / 用户 B 各自的成熟度分数。
- 成熟度等级。
- 六个成熟度分项条形图。
- Memory / Proposal / Snapshot / Node 数量。
- 当前 Runtime 状态。
- Recommendations。

该区域是后台治理视图，不是用户端体验。真实产品中，微信 / App / 小程序端不应展示这些机制名。

### 2.5 测试

文件：

```text
nnz-mvp/src/domain/soul-scope.test.ts
```

新增测试：

- `builds user-scoped Soul maturity reports without cross-user leakage`

覆盖点：

- A / B 同名“爸爸”生成两份独立成熟度报告。
- A 增加 correction memory 和 pending proposal 后，只改变 A 的 report。
- B 的 `memoryCount`、`proposalCount`、`pendingProposalCount` 保持不变。
- 缺少 `userId` 调用 `buildSoulMaturityReport` 会抛 `ScopeValidationError`。

## 3. 验证记录

### 3.1 语法转译检查

执行过：

```bash
node - <<'NODE'
# 使用 TypeScript transpileModule 检查：
# src/domain/types.ts
# src/domain/soul-store.ts
# src/domain/soul-scope.test.ts
# src/demo-server.ts
NODE
```

结果：

```text
transpile syntax ok
```

说明：当前 iCloud / Obsidian 路径下 `npm run typecheck` / `npm test` 偶发卡住，故优先使用轻量转译 + API 验证。

### 3.2 dist-cjs 转译

已重新生成：

```text
nnz-mvp/dist-cjs
```

服务启动：

```bash
node dist-cjs/demo-server.js
```

地址：

```text
http://127.0.0.1:3007
```

### 3.3 API 验证

已验证流程：

```text
reset
apply-correction
accept-correction
run-all
```

关键结果：

- reset 后：
  - A `score=53`, `level=L2_USABLE`
  - B `score=53`, `level=L2_USABLE`
  - A/B 均无 Memory、Proposal
- A 生成 correction proposal 后：
  - A `score=63`, `level=L3_STABLE`
  - A `memory=1`
  - A `proposal=1`
  - A `pending=1`
  - A recommendations 包含 `REVIEW_PROPOSAL`
  - B 仍然 `memory=0`, `proposal=0`
- A 接受 proposal 后：
  - A `accepted=1`
  - A `pending=0`
  - B `accepted=0`
- `run-all` 后：
  - 6 条验证全部 PASS
  - A `score=75`, `level=L3_STABLE`
  - A recommendations 出现 `SUGGEST_SEAL`
  - B 保持 `L2_USABLE`

### 3.4 页面验证

浏览器打开：

```text
http://127.0.0.1:3007
```

确认页面存在：

```text
Soul Ops Console
后台治理视图
```

并能看到：

- 用户 A · 爸爸
- 用户 B · 爸爸
- A/B 不同成熟度分数。
- A/B 不同 Memory / Proposal / Node 数量。
- A/B 各自 recommendations。

## 4. 当前文件变更清单

核心代码：

```text
nnz-mvp/src/domain/types.ts
nnz-mvp/src/domain/soul-store.ts
nnz-mvp/src/domain/soul-scope.test.ts
nnz-mvp/src/demo-server.ts
```

文档：

```text
nnz-mvp/README.md
nnz-mvp/CLAUDE_CODE_HANDOFF.md
CLAUDE_CODE_HANDOFF.md
念念在-产品与技术架构：后台治理与Soul成熟度.md
nnz-mvp-Step4.5-SoulOps后台治理实施记录.md
```

## 5. 设计原则

### 5.1 用户端无感

微信 / App / 小程序端不应该展示：

- `SoulVersion`
- `SoulSnapshot`
- `SoulUpdateProposal`
- `MemoryItem`
- `enabledForSoulUpdate`
- `userId + personaId`
- evidence chain
- LLM prompt
- retrieval

用户端只应感知：

- 创建某个亲人的 AI。
- 上传 / 描述记忆。
- 对话。
- 节点重启。
- 封存 / 毕业 / 导出 / 删除。

### 5.2 后台端透明

后台需要展示机制，方便运营、审核、产品和研发：

- 用户生命周期。
- Persona 列表。
- Memory Vault。
- Soul Kernel。
- Proposal Review。
- Snapshot / Covenant。
- Risk Event。
- Soul Maturity。

### 5.3 不破坏 Soul 私有作用域

成熟度报告也必须遵守：

```text
userId + personaId
```

即使 A / B 都创建了同名“爸爸”，成熟度报告也必须是两份独立报告。

## 6. 下一步建议

建议进入：

```text
Step 4.6: Soul Ops Console 管理台化
```

目标：

- 把当前单页里的后台治理区域拆成更像管理台的结构。
- 增加 Tab：
  - Users
  - Persona / Soul
  - Memory Vault
  - Proposals
  - Snapshots
  - Risk
- 支持点击 A/B 切换详情。
- 展示 proposal 队列而不是只在用户 A 面板展示。
- 展示 Snapshot 历史。
- 展示风险事件占位。

Step 4.6 完成后，再进入：

```text
Step 5: 真实 LLM 接入
```

真实 LLM 接入前仍需保留：

- scope guard
- mechanism leak guard
- private memory selection
- proposal review
- maturity recompute
- risk guard

## 7. 给下一位 AI 的注意事项

1. 不要把 `SoulMaturityReport` 做成全局逝者评分。
2. 不要跨用户汇总同名 Persona。
3. 不要把后台机制词泄露到角色回复中。
4. 不要让 LLM 直接改写 Soul Kernel；应先生成 proposal。
5. 当前成熟度算法可替换，但接口和作用域边界不要破坏。
6. 如果 `npm test` 或 `npm run typecheck` 在 iCloud 路径卡住，先检查并清理 `tsc` / `vitest` 残留进程，再使用 API 验证辅助确认。
