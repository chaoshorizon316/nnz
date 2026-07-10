# nnz-mvp 2026-07-10 Step 2.60 H5 Covenant Actions DOM Rendering

## 背景

Step 2.57-2.59 已把 H5 对话区、官网在线咨询、H5 创建选项逐步改成 DOM `textContent` 渲染。继续审计 H5 用户端核心生命周期控件时发现，`h5RefreshCovenantState()` 仍通过 `actions.innerHTML` 拼接封存、开启特别时刻、毕业、完成特别时刻等操作控件，并使用 inline `onclick` 字符串绑定。

这些控件是用户从 ACTIVE / SEALED / NODE / GRADUATED 流转的关键入口。为了让生命周期操作区也遵循统一渲染策略，本步骤改为 DOM 节点创建和事件监听绑定。

## 本次变更

- `h5RefreshCovenantState()` 清空操作区时改为 `actions.textContent = ''`。
- 新增 `h5CreateCovenantButton(label, className, onClick)`，用 `document.createElement('button')`、`textContent` 和 `addEventListener('click', ...)` 创建操作按钮。
- 新增 `h5CreateNodeNameInput()`，用 DOM API 创建特别时刻名称输入框，保留原有样式、id 和 placeholder。
- ACTIVE / SEALED / NODE 状态下的操作控件均改为 `appendChild(...)`。
- `src/h5-experience.test.ts` 更新 inline confirmation 断言，并新增 Covenant action controls DOM rendering 回归。

## 回归覆盖

- 封存按钮仍打开页面内“安放”确认，不会直接执行封存。
- 特别时刻名称输入仍使用 `h5NodeName`，空名称仍被 `h5ActivateNode()` 拦截。
- 毕业按钮仍打开页面内“告别”确认。
- NODE 完成按钮仍打开页面内“收束”确认，不会直接完成。
- 不改变 Covenant API、状态机、scoped runtime、导出、删除或 release validation 入口。

## 本地验证

```text
npm test -- h5-experience
1 passed; 18 passed

npm run typecheck
passed

npm test
34 passed | 2 skipped; 229 passed | 2 skipped

npm run build:demo
passed
```

## 状态

- Step 2.60 本地已完成，尚待下一次合并 push。
- 最新已推送提交是 `a1a66ec fix: render h5 onboarding choices with DOM text APIs`。
- 核心上线闸口不变：仍需外部输入后运行 `release:validation-suite -- --evidence-out <sanitized-release-evidence-json>`。
