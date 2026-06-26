# nnz-mvp 2026-06-25 Step 2.9：snapshot -> scoped tables 迁移预检

## 目标

Step 2.9 的目标是在切换 demo runtime persistence 前，先建立一个离线迁移预检层，用当前 `nnz_store_snapshots.snapshot_json` 的 `StoreSnapshot` 结构生成 scoped tables 迁移计划。

本阶段不做线上写入：

- 不读取 `DATABASE_URL`。
- 不连接 Render 生产库。
- 不执行 `INSERT` / `DELETE` / `UPDATE`。
- 不切换 demo runtime persistence。

## 范围

新增纯函数迁移 planner，输入 `StoreSnapshot`，输出：

- 目标表 insert 顺序。
- 每张 scoped table 的 row count。
- 阻断迁移的结构错误。
- 可人工审阅但不阻断的 warning。

预检重点：

- 所有 Soul / Memory / Snapshot / Node / Conversation / Session / Proposal 都必须能回到同一个 `userId + personaId`。
- `SoulSnapshot.soulVersionId` 必须指向同 scope 的 SoulVersion。
- `SoulSnapshot.memoryIds` 必须都属于同 scope。
- proposal evidence 必须都属于同 scope。
- conversation node / session node 必须属于同 scope。
- credential 必须绑定存在的 user。
- OpsAudit 是全局审计表，不用 FK 绑定 user；如 target user 已不存在，只输出 warning。

## 验收标准

```text
npm run typecheck
npm test
npm run build:demo
git diff --check
```

## 实施结果（2026-06-25）

已完成纯函数离线 migration planner：

- 新增 `src/domain/postgres-scoped-migration-plan.ts`。
- 新增 `src/domain/postgres-scoped-migration-plan.test.ts`。
- planner 输入 `StoreSnapshot`，输出 scoped table insert 顺序、每表 row count、总 row count、blocking errors 和 non-blocking warnings。
- 校验所有 scope-bound 对象都能回到同一个 `userId + personaId`。
- 校验 snapshot -> SoulVersion / Memory、proposal -> evidence、conversation/session -> node 的同 scope 引用。
- 校验 credential 绑定存在 user，且 user/email 不重复。
- 校验每个 `userId + personaId` 最多一个 ACTIVE SoulVersion。
- OpsAudit 作为后台全局表，只对缺失 target user 输出 warning，不阻断迁移。
- Session 校验兼容当前 `store.serialize()` 的 `nodeContext` 形态和旧的扁平 `nodeId` / `nodeName` 形态。

本阶段仍未读取 `DATABASE_URL`、未连接 Render、未写入任何数据库，也未替换 demo runtime persistence。

## 本地验证

```text
npm run typecheck: passed
npm test -- src/domain/postgres-scoped-migration-plan.test.ts --reporter verbose: passed, 3 tests
npm test: passed, 14 test files / 90 tests, 1 integration file skipped
npm run build:demo: passed
```

尚未执行：

```text
git diff --check
NNZ_POSTGRES_INTEGRATION_URL=... npm test -- src/domain/postgres-scoped-soul-repository.integration.test.ts
```

原因：本轮仍未提供一次性测试库连接串；为避免误连 Render / production database，未自动读取 `DATABASE_URL` 或其他环境变量。

## 下一步

1. 使用一次性 Postgres 测试库实际运行 Step 2.8 的 opt-in integration test。
2. 用真实 `StoreSnapshot` 样本调用 Step 2.9 planner，审阅 errors / warnings / row count。
3. 只有 dry-run plan 可解释且无 blocking errors 后，再设计实际 snapshot -> scoped tables 迁移执行器。

## 产品与伦理边界

本阶段是后端数据可靠性工作，不新增用户前台功能。

符合产品红线：

- 不改变 Covenant 节奏。
- 不增加用户依赖。
- 不向用户暴露 repository / scope / snapshot / migration 等机制。
- 为未来数据主权、删除、导出和毕业流程打基础。
