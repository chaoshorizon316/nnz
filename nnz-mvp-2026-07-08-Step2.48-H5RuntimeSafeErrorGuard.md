# nnz-mvp 2026-07-08 Step 2.48 H5 Runtime Safe Error Guard

## 背景

Step 2.47 已经把 H5 静态可见文案纳入机制泄露护栏。但继续审阅 H5 运行时路径时发现，部分接口失败会把后端 `data.error` / `error.message` 原样放进状态栏或聊天气泡。

这些错误一般不会在正常路径触发，但上线前应避免任何 `personaId`、raw lifecycle state、Covenant 或“节点重启”等机制表达被用户看到。

## 本次变更

- `public/index.html` 新增 `H5_UNSAFE_ERROR_FRAGMENTS` 和 `h5SafeErrorMessage(error, fallback)`。
- H5 展示错误前统一过滤：
  - 登录状态恢复。
  - 体验模式。
  - 登录/注册。
  - 导出数据。
  - 删除全部数据。
  - 创建记忆伙伴。
  - 补充记忆。
  - 毕业。
  - Covenant 操作：封存、开启特别时刻、完成特别时刻。
  - 发送消息失败后的聊天气泡。
- `h5CovenantAction()` 不再直接显示 `data.error`；遇到内部机制词时回退为“刚才没有完成，请稍后再试。”。
- `h5Request()` 仍保留 raw error 作为内部传递，展示层负责安全化。

## 回归覆盖

- `src/h5-experience.test.ts` 新增运行时错误安全化回归：
  - H5 脚本包含 unsafe fragments。
  - H5 展示点使用 `h5SafeErrorMessage()`。
  - Covenant 操作不再使用 `data.error || '刚才没有完成，请稍后再试。'`。
- 调整补充记忆测试口径：允许脚本里的机制词清单存在，但用户可见文本不能出现 `MemoryItem`。

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

- 本地 Step 2.48 已完成，尚待下一次合并 push。
- 最新已推送提交是 `0d78c32 test: guard h5 visible copy against mechanism leaks`。
- 最新本地后续是 Step 2.49 H5 user-facing copy softening。
- 核心上线闸口不变：仍需外部输入后运行 `release:validation-suite -- --evidence-out <sanitized-release-evidence-json>`。
