# nnz-mvp 2026-07-08 Step 2.52 H5 Persona Switcher Safe Rendering

## 背景

继续复核 H5 用户端时发现，`h5UpdatePersonaList()` 用 `innerHTML` 拼接 persona 下拉框选项。`displayName` 和 `relationship` 来自用户输入，虽然当前落点是 `<option>` 文本，但上线前仍应避免把用户输入拼进 HTML 字符串。

这个修复不改变 API、不改变 `userId + personaId` 作用域，也不新增 migration；它只收紧前端渲染路径。

## 本次变更

- `public/index.html` 中 `h5UpdatePersonaList()` 改为：
  - `sel.textContent = ''` 清空旧选项。
  - `document.createElement('option')` 创建下拉项。
  - `option.value = persona.id` 写入值。
  - `option.textContent = persona.displayName + '（' + persona.relationship + '）'` 写入可见文本。
  - `sel.appendChild(option)` 挂载节点。
- `src/h5-experience.test.ts` 新增静态回归测试，防止 persona switcher 回退到 `innerHTML` 字符串拼接。

## 回归覆盖

- persona 下拉框仍展示称呼与关系。
- 用户输入的称呼/关系不再进入 HTML 字符串拼接路径。
- 不改变登录、persona 切换、Covenant、memory、chat、export/delete 流程。

## 本地验证

```text
npm test -- h5-experience
1 passed; 14 passed

npm run typecheck
passed

npm test
34 passed | 2 skipped; 225 passed | 2 skipped

npm run build:demo
passed
```

## 状态

- 本地 Step 2.52 已完成，尚待下一次合并 push。
- 最新已推送提交是 `58c0fe5 fix: handle h5 conversation load errors safely`。
- 核心上线闸口不变：仍需外部输入后运行 `release:validation-suite -- --evidence-out <sanitized-release-evidence-json>`。
