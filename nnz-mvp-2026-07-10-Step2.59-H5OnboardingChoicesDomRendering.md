# nnz-mvp 2026-07-10 Step 2.59 H5 Onboarding Choices DOM Rendering

## 背景

Step 2.57 和 Step 2.58 已分别把 H5 登录态对话区、官网首页在线咨询改成 DOM `textContent` 渲染。继续审计 H5 创建流程时发现，常用称呼和性格特征选项仍由常量数组拼成 HTML 字符串，再写入 `innerHTML`。

这些内容目前来自代码内常量，不是用户输入；但它们属于用户端 onboarding 的可见交互控件。为了保持用户端渲染策略一致，并降低未来维护时把可变内容拼进 HTML 的风险，本步骤把创建流程选项也改为 DOM text API。

## 本次变更

- `public/index.html` 的 `h5InitQuickNames()` 改为清空容器后逐个创建 `button.quick-name`。
- 常用称呼按钮使用 `button.textContent = name`，点击行为通过 `addEventListener('click', ...)` 绑定，不再使用 inline `onclick` 字符串。
- `h5InitTraits()` 改为逐个创建 group、label、checkbox、label/description span。
- 性格特征 label 和 desc 均通过 `textContent` 渲染，checkbox change 通过 `addEventListener('change', ...)` 绑定。
- `src/h5-experience.test.ts` 增加静态回归，防止 onboarding choice controls 回退到 `innerHTML` / inline handler。

## 回归覆盖

- 常用称呼和性格特征文案不会被当作 HTML 解析。
- 保留原有 quick name 选中态、特征多选和已选特征恢复行为。
- 不改变 persona 创建 payload、consent gate、Covenant、导出、删除或 scoped runtime 逻辑。
- 不改变 release validation 外部输入要求。

## 本地验证

```text
npm test -- h5-experience
1 passed; 17 passed

npm run typecheck
passed

npm test
34 passed | 2 skipped; 228 passed | 2 skipped

npm run build:demo
passed
```

## 状态

- Step 2.59 本地已完成，尚待下一次合并 push。
- 最新已推送提交是 `c97c715 fix: render marketing chat with DOM text APIs`。
- 核心上线闸口不变：仍需外部输入后运行 `release:validation-suite -- --evidence-out <sanitized-release-evidence-json>`。
