# nnz-mvp 2026-07-08 Step 2.46 H5 Panel Mutual Exclusion

## 背景

Step 2.44/2.45 推送后，H5 的封存、节点完成、毕业都已改为页面内确认；补充记忆也有独立面板。继续做最后一轮用户旅程收口时，发现这些面板可以在部分路径下同时展开，例如打开毕业确认时补充记忆面板仍可能保留。

这不会破坏后端状态机，但会让 H5 当前任务不够清晰。用户在哀伤场景里不应同时面对多个关键动作入口。

## 本次变更

- 打开“补充记忆”面板时，自动收起封存确认、节点完成确认、毕业确认面板。
- 打开毕业确认时，自动收起补充记忆面板。
- 从 SEALED 状态开启特别时刻时，自动收起毕业确认和补充记忆面板。
- 保留现有封存 / 节点完成面板打开时收起其他关键确认的行为。

## 回归覆盖

- `src/h5-experience.test.ts` 新增互斥面板回归：
  - `h5ToggleMemoryPanel()` 打开时会取消三个 Covenant 确认面板。
  - `h5OpenGraduateConfirm()` 会收起补充记忆面板。
  - `h5ActivateNode()` 会收起毕业确认和补充记忆面板。

## 本地验证

```text
npm test -- h5-experience
1 passed; 11 passed

npm run typecheck
passed

npm test
34 passed | 2 skipped; 222 passed | 2 skipped

npm run build:demo
passed

git diff --check
passed
```

## 状态

- 本地 Step 2.46 已完成，尚待下一次合并 push。
- 最新已推送提交是 `12c0548 feat: add h5 node completion and activation safeguards`。
- 核心上线闸口不变：仍需外部输入后运行 `release:validation-suite -- --evidence-out <sanitized-release-evidence-json>`。
