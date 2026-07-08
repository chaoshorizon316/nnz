# nnz-mvp 2026-07-08 Step 2.45 H5 Node Activation Inline Status

## 背景

Step 2.44 已把 NODE 阶段“完成这个时刻”改为页面内确认。继续检查 SEALED 阶段的节点开启入口时，发现如果用户未填写节点名称，H5 会默认提交“重要时刻”。这会弱化节点本应对应明确人生事件的产品边界，也容易造成误触。

同时，Covenant 操作失败仍使用浏览器 `alert()`。这不符合 H5 体验的一致性，也不利于移动端内联错误反馈。

## 本次变更

- `h5ActivateNode()` 不再为空输入兜底“重要时刻”。
- 开启特别时刻前必须填写具体名称；未填写时在 Covenant bar 内显示提示并聚焦输入框。
- Covenant bar 新增 `h5CovenantStatus` 作为内联状态提示。
- `h5CovenantAction()` 的失败和网络错误不再使用 `alert()`，改为内联状态文案。
- 成功开启特别时刻后显示“这个时刻已开启。”。

## 回归覆盖

- `src/h5-experience.test.ts` 新增节点开启与 Covenant inline error 回归：
  - 存在 `h5CovenantStatus`。
  - `h5ActivateNode()` 要求 `h5NodeName` trim 后非空。
  - 空名称时显示“写下这个时刻的名字后再开启。”并聚焦输入。
  - 不再包含 `|| '重要时刻'` 兜底。
  - `h5CovenantAction()` 不再包含 `alert(`，改用 `h5SetStatus('h5CovenantStatus', ...)`。

## 本地验证

```text
npm test -- h5-experience
1 passed; 10 passed

npm run typecheck
passed

npm test
34 passed | 2 skipped; 221 passed | 2 skipped

npm run build:demo
passed

git diff --check
passed
```

## 状态

- 本地 Step 2.45 已完成，建议与 Step 2.44 合并为下一次 push。
- 最新已推送提交是 `e4a14dd feat: persist runtime usage and add seal confirmation`。
- 核心上线闸口不变：仍需外部输入后运行 `release:validation-suite -- --evidence-out <sanitized-release-evidence-json>`。
