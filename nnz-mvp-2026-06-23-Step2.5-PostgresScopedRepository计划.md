# nnz-mvp 2026-06-23 Step 2.5：Postgres scoped repository 计划

## 目标

Step 2.5 的目标是把当前 Postgres `nnz_store_snapshots` 单行 JSONB 快照，逐步演进为按 `userId + personaId` 强约束的 Postgres repository。

本阶段先做最小切片，不替换线上运行时持久化：

- 新增 Postgres scoped repository contract。
- 新增逐表 schema 的最小集合。
- 先覆盖 Persona / Memory / Conversation 这条 H5 与对话主链。
- 用 fake Postgres pool 测试证明同名 Persona 在不同用户下不会串读串写。

## 为什么先做最小切片

当前线上 Postgres snapshot persistence 已稳定服务 demo。直接整体迁移 SoulVersion、Snapshot、Proposal、Node、Conversation、Session、Credential、Ops Audit 风险过大。

更稳的做法是：

1. 保留现有 snapshot persistence 作为线上兼容路径。
2. 在旁路新增 scoped repository，实现可测试、可审计的逐表数据访问模式。
3. 先让最常用、最容易验证的用户链路落地：Persona -> Memory -> Conversation。
4. 再逐步扩展 SoulVersion / Snapshot / Proposal / Node / RuntimeSession。

## Scope Rules

不可破坏的最高优先级规则：

- Soul / Memory / Snapshot / Node / Conversation 访问必须同时携带 `userId + personaId`。
- 禁止只按 `personaId` 查询。
- 禁止按 displayName / relationship 自动合并 Soul。
- 禁止 A 用户的记忆、聊天、节点事件进入 B 用户结果。
- 删除或迁移时必须保证 A 用户数据不会影响 B 用户数据。

## 本次最小数据表

本次只建最小可验证表：

```text
nnz_users
nnz_personas
nnz_memory_items
nnz_conversation_messages
```

设计要求：

- `nnz_personas` 必须有 `(user_id, id)` 唯一约束，支持 ownership 校验。
- `nnz_memory_items` 必须有 `(user_id, persona_id, created_at)` 索引。
- `nnz_conversation_messages` 必须有 `(user_id, persona_id, created_at)` 索引。
- Memory / Conversation 写入前必须确认 persona 属于该 user。

## MVP vs Next Phase

本阶段包含：

- `createPostgresScopedSoulRepositoryFromPool(pool)`
- `ensurePostgresScopedSchema()`
- `createUser`
- `createPersona`
- `getPersona`
- `listPersonasForUser`
- `addMemory`
- `listMemory`
- `listRuntimeMemory`
- `listSoulUpdateMemory`
- `addConversation`
- `listConversations`

暂不包含：

- 替换 demo-server 的当前 snapshot persistence。
- 数据迁移脚本。
- SoulVersion / Snapshot / Proposal / Node / RuntimeSession 逐表实现。
- 加密落盘。
- 真 Postgres 集成测试。

## 验收标准

本地必须通过：

```text
npm run typecheck
npm test
npm run build:demo
git diff --check
```

新增测试至少覆盖：

- 同名「爸爸」在 user A / user B 下创建后互不影响。
- user A 只能列出自己的 personas。
- repo A 写入 memory / conversation 后，repo B 读不到。
- 使用 user A + persona B scope 读写时抛 OwnershipError。
- Memory runtime / soul update filters 与当前 InMemorySoulStore 规则一致。

## 实施结果（2026-06-23）

已完成最小旁路切片：

- 新增 `src/domain/postgres-scoped-soul-repository.ts`。
- 新增 `nnz_users`、`nnz_personas`、`nnz_memory_items`、`nnz_conversation_messages` schema。
- `nnz_memory_items` / `nnz_conversation_messages` 通过 `(user_id, persona_id)` 复合外键绑定到 `nnz_personas(user_id, id)`。
- 新增 `PostgresScopedSoulRepository`，构造时必须绑定完整 `{ userId, personaId }`。
- 支持 create/list user persona、get bound persona、add/list memory、runtime/soul-update memory filters、add/list conversations。
- 记忆默认值与 `InMemorySoulStore` 对齐：`RISK` 默认 `RESTRICTED` 且不进 runtime/soul update；`NODE_MEMORY` 可进 runtime 但不进 soul update；`confidence` 必须在 0..1。
- 新增 fake Postgres pool 测试，覆盖同名「爸爸」在不同 user 下 persona、memory、conversation 全隔离，以及 user A + persona B scope 拒绝读写。

本阶段仍未替换 demo runtime 的 Postgres snapshot persistence；线上路径继续使用当前稳定的 `nnz_store_snapshots` JSONB 快照。

## 本地验证

```text
npm run typecheck: passed
npm test: passed, 13 test files / 84 tests
npm run build: passed
npm run build:demo: passed
git diff --check: passed
```

## 伦理与产品边界

本阶段不增加任何会延长用户依赖的用户功能，只增强数据边界和持久化可靠性。

符合产品红线：

- 帮助用户拥有数据主权，而不是增强粘性。
- 不改变 Covenant 封存 / 节点 / 毕业节奏。
- 不向用户暴露 `userId`、`personaId`、repository、scope 等机制词。
- 为后续删除、导出、毕业流程打基础。
