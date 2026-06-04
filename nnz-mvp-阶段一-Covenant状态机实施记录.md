# nnz-mvp 阶段一：Covenant 状态机 + Snapshot 封存 — 实施记录

> 日期：2026-06-03
> 基于计划：`CLAUDE_CODE_HANDOFF.md` Step 1 + Step 4 合并推进

## 实施内容

将「念念在」核心流转——**ACTIVE → SEALED → NODE → SEALED → ... → GRADUATED**——植入代码。

### 类型层

- `SoulStatus` 新增 `'GRADUATED'`
- `SoulSnapshot` 新增 `kernelJson: Record<string, unknown>` 和 `memoryIds: string[]`，封存时捕获完整 Soul + Memory 状态
- 新增 `RuntimeContext` 接口
- `CovenantStateError` 错误类

### Store 层

`InMemorySoulStore` 新增：

- `sessions: Map<string, RuntimeSession>` — 按 scope 追踪 covenant 状态
- `sealSoul(scope)` — 创建 snapshot + 归档 soul → SEALED
- `activateNode(scope, nodeName, durationDays?)` — SEALED → NODE
- `completeNode(scope)` — NODE → SEALED
- `graduateSoul(scope)` — → GRADUATED
- `getRuntimeSession(scope)` — 查询当前状态
- `getRuntimeContext(scope)` — 按状态组装 soul+memories；SEALED/GRADUATED 抛 CovenantStateError

### Runtime 层

- `generateSoulReply` 签名不变，仍接收 `(soul, memories, message)`——保持纯函数
- 新增导出常量 `SEALED_REPLY`、`GRADUATED_REPLY`

### Demo 层

- 4 个新 API：`/api/seal`、`/api/activate-node`、`/api/complete-node`、`/api/graduate`
- `sendMessageToBothUsers` 改为按 covenant 状态分叉回复
- UI 新增状态标签、流转按钮组、封存/毕业时禁用输入框

## 关键决策

1. **Runtime 保持纯函数**：不注入 session/state，由调用方（demo server）通过 `getRuntimeContext` 组装输入后传入
2. **NODE 状态下的 Soul 从 snapshot.kernelJson 临时重建**（id 用 snapshotId，version=-1），不创建新 SoulVersion
3. **SEALED/GRADUATED 状态的回复不经过 runtime**，直接在 demo server 返回常量文案
4. **`activateNode` 只允许从 SEALED 调用**（必须先封存再节点重启）
5. **`SoulStatus` 新增 `GRADUATED`** 而非复用 ARCHIVED

## 测试覆盖

15 条测试全部通过（原有 9 条 + 新增 6 条）：

- 2 条 soul-scope 已有测试适配 snapshot 新字段
- 5 条新增 covenant 测试（seal/activateNode/completeNode/graduate/A不影响B）
- 1 条 runtime 测试（SEALED_REPLY/GRADUATED_REPLY 无机制词泄漏）

## 验证结果

- `npm run typecheck` ✅
- `npm test` ✅ (15/15)
- `npm run build:demo` ✅
- 手动流转验证 ✅：
  - 初始 A/B 均为 ACTIVE
  - 封存 A → A=SEALED, B=ACTIVE
  - 节点重启 A → A=NODE（使用 snapshot kernel + 节点记忆回复）, B=ACTIVE
  - 完成节点 → A=SEALED, B=ACTIVE
  - 毕业 → A=GRADUATED, B=ACTIVE
  - 封存后发送消息 → A 返回封存提示，B 正常回复
  - 旧流程（run-all）6/6 PASS 全部兼容

## 下一步

阶段二：Memory 架构分层 + 真实 LLM 预备
