# nnz-mvp 2026-07-07 Step 2.37 H5 Graduation Export and Safety Support UX

## 目标

补齐 H5 用户离开路径里的数据主权承诺，并把已有高风险 guard 回复提升成更清晰的用户支持提示：用户点击“毕业”时，先拿到自己的数据档案，再提交毕业状态；高风险回复出现时，H5 显示现实支持提示和热线拨号入口。此步骤不新增 migration CLI，不改变 scoped runtime / release validation 的外部实跑入口。

## 本次改动

- `nnz-mvp/public/index.html`
  - `h5ExportData()` 复用新的 `h5DownloadDataArchive()`，避免导出逻辑散落。
  - `h5Graduate()` 现在先请求 `/api/me/export` 并触发下载，再提交 `/api/me/graduate`。
  - 毕业确认与完成提示明确告知“数据档案”已交还用户。
  - 状态徽标不再用内部状态名兜底显示，改为“状态更新中”。
  - 状态文案改为用户可理解的“可继续说话 / 正在休息 / 特别时刻 / 已好好告别”。
  - 封存与特别时刻相关文案弱化机制感。
  - `/api/me/covenant-state` 查询对 persona id 做 `encodeURIComponent`。
  - 登录状态提示区域从固定高度改为最小高度，避免长提示被挤压。
  - 新增默认隐藏的 `h5SafetySupport` 支持提示条；当助手回复包含现有 guard 的心理援助热线或“请现在就联系能真正帮助你的人”时展示。
  - 支持提示条提供 `tel:4001619995` 拨号入口，并提醒用户立刻联系身边的人或心理援助热线。
- `nnz-mvp/src/h5-experience.test.ts`
  - 固化“导出发生在毕业提交前”。
  - 固化状态徽标不再向用户显示 raw lifecycle state fallback。
  - 固化风险回复出现时有独立支持提示条和拨号入口。

## 安全与产品边界

- 用户端没有新增 `SoulVersion`、`SoulSnapshot`、`scope`、`evidence`、`migration` 等后台机制词。
- 本次没有新增 persona-only 查询，也没有改动后端 `userId + personaId` 作用域边界。
- 数据导出仍走既有 `GET /api/me/export`，只导出当前登录用户自己的数据，不含 credential hash 或后台 OpsAudit。
- 毕业仍走既有 `POST /api/me/graduate`，只影响当前登录用户当前 persona。
- 风险提示复用既有 `checkMessageSafety()` / `RISK_REPLY` 输出，不新增敏感数据收集，也不承诺尚未实现的人工升级闭环。

## 验证

```text
npm test -- h5-experience: 3 tests passed
npm run typecheck: passed
npm test: 33 个测试文件 passed，209 tests passed；2 个 integration 文件 skipped
npm run build:demo: passed
git diff --check: passed
```

## 下一步

1. 合并 push Step 2.37。
2. 外部输入齐备后运行带 `--evidence-out` 的 `release:validation-suite`。
