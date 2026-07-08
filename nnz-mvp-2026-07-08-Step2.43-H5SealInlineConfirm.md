# nnz-mvp 2026-07-08 Step 2.43 H5 Seal Inline Confirm

## 背景

产品进程审计指出 Seal / Node / Graduation 还需要形成更稳定的用户旅程。Step 2.41 已把毕业从浏览器确认改为 H5 页面内确认，但首次“封存”仍是一键立即执行。封存是产品“帮助用户离开，而不是留下”的关键动作，应当让用户主动确认，而不是误触即进入安静状态。

## 本次变更

- H5 对话区新增 `h5SealConfirmPanel` 页面内确认面板。
- ACTIVE 状态下的“封存”按钮改为打开确认面板，不再直接调用 `/api/me/seal`。
- 用户需要输入“安放”后才会执行封存。
- 面板文案强调：封存后对话会暂时安静下来，用户仍可导出数据，也可在重要时刻开启短暂陪伴。
- 切换 persona、新建 persona、封存成功后会收起封存确认面板。
- `h5CovenantAction()` 返回 success boolean，让封存成功后再关闭确认面板。

## 回归覆盖

- `src/h5-experience.test.ts` 新增封存确认回归：
  - 存在 `h5SealConfirmPanel`。
  - 确认词为“安放”。
  - ACTIVE 状态按钮调用 `h5OpenSealConfirm()`，不直接调用 `h5SealSoul()`。
  - `h5ConfirmSeal()` 校验确认词后才调用 `h5SealSoul()`。
  - `h5SealSoul()` 仅在 API 成功后关闭确认面板。

## 本地验证

```text
npm test -- h5-experience
1 passed; 8 passed

npm run typecheck
passed

npm test
34 passed | 2 skipped; 219 passed | 2 skipped

npm run build:demo
passed

git diff --check
passed
```

## 状态

- 本地 Step 2.43 已完成，建议与 Step 2.42 合并为下一次 push。
- 最新已推送提交仍是 `adac0ea feat: add h5 memory append and graduation confirmation`。
- 核心上线闸口不变：仍需外部输入后运行 `release:validation-suite -- --evidence-out <sanitized-release-evidence-json>`。
