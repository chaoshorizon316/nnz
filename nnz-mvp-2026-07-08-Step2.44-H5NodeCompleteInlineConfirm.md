# nnz-mvp 2026-07-08 Step 2.44 H5 Node Complete Inline Confirm

## 背景

Step 2.43 已把首次“封存”改为页面内确认。继续补 Seal / Node / Graduation 用户旅程时，发现 NODE 阶段的“完成这个时刻”仍是一键执行。这个动作会把短暂陪伴收束回安静状态，应当和封存、毕业一样需要用户主动确认。

## 本次变更

- H5 对话区新增 `h5NodeCompleteConfirmPanel` 页面内确认面板。
- NODE 状态下“完成这个时刻”按钮改为打开确认面板，不再直接调用 `/api/me/complete-node`。
- 用户输入“收束”后才会执行完成节点。
- 面板文案强调：完成后特别时刻会安静收束，对话会回到休息状态。
- 切换 persona、新建 persona、离开 NODE 状态、完成成功后会收起节点完成确认面板。

## 回归覆盖

- `src/h5-experience.test.ts` 新增节点完成确认回归：
  - 存在 `h5NodeCompleteConfirmPanel`。
  - 确认词为“收束”。
  - NODE 状态按钮调用 `h5OpenNodeCompleteConfirm()`，不直接调用 `h5CompleteNode()`。
  - `h5ConfirmCompleteNode()` 校验确认词后才调用 `h5CompleteNode()`。
  - `h5CompleteNode()` 仅在 API 成功后关闭确认面板。

## 本地验证

```text
npm test -- h5-experience
1 passed; 9 passed

npm run typecheck
passed

npm test
34 passed | 2 skipped; 220 passed | 2 skipped

npm run build:demo
passed

git diff --check
passed
```

## 状态

- 本地 Step 2.44 已完成，尚待下一次合并 push。
- 最新已推送提交是 `e4a14dd feat: persist runtime usage and add seal confirmation`。
- 核心上线闸口不变：仍需外部输入后运行 `release:validation-suite -- --evidence-out <sanitized-release-evidence-json>`。
