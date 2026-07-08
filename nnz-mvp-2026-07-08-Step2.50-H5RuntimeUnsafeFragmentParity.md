# nnz-mvp 2026-07-08 Step 2.50 H5 Runtime Unsafe Fragment Parity

## 背景

Step 2.49 把“节点重启 / AI人格 / 毕业机制”等机制化表达加入 H5 可见文案护栏。继续复核时发现，运行时错误过滤词表 `H5_UNSAFE_ERROR_FRAGMENTS` 还没有同步补齐这些新增词。

虽然正常接口路径不会刻意返回这些表达，但 H5 展示层应该以同一套用户边界兜底，避免后端错误内容绕过静态可见文案护栏。

## 本次变更

- `public/index.html` 的 `H5_UNSAFE_ERROR_FRAGMENTS` 补齐：
  - `后台通知`
  - `人工审核`
  - `极端情绪词汇`
  - `AI模型`
  - `AI人格`
  - `基础 AI 人格`
  - `基础AI人格`
  - `毕业机制`
- `src/h5-experience.test.ts` 同步断言这些词进入运行时错误过滤清单。
- 测试不再只靠逐项手写断言，而是解析 `H5_UNSAFE_ERROR_FRAGMENTS` 并校验其包含全部 `USER_VISIBLE_MECHANISM_TERMS`。

## 回归覆盖

- `npm test -- h5-experience` 覆盖：
  - 静态可见文案不包含机制词。
  - H5 运行时错误展示点使用 `h5SafeErrorMessage()`。
  - 运行时 unsafe fragments 覆盖新增文案禁用词。
  - 运行时 unsafe fragments 至少包含完整 visible mechanism terms，防止两个词表后续漂移。

## 本地验证

```text
npm test -- h5-experience
1 passed; 13 passed

npm run typecheck
passed

npm test
34 passed | 2 skipped; 224 passed | 2 skipped

npm run build:demo
passed
```

## 状态

- 本地 Step 2.50 已完成，尚待下一次合并 push。
- 最新已推送提交是 `ca296ca fix: sanitize h5 runtime errors and soften copy`。
- 核心上线闸口不变：仍需外部输入后运行 `release:validation-suite -- --evidence-out <sanitized-release-evidence-json>`。
