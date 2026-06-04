# 念念在 / NNZ

念念在是一个以“让爱有处安放，让告别有期”为目标的 Grief-Tech 产品与技术原型。当前仓库同时保存产品知识库、H5 原型页面、TypeScript MVP 领域模型，以及给后续 AI 协作者使用的交接文档。

## Core Invariant

MVP 的最高优先级规则是：

```text
Soul scope = userId + personaId
```

不同用户为同一个逝者创建的 AI 必须生成不同 Soul。系统不得建立全局 `DeceasedSoul`，不得跨用户聚合、共享、污染或自动合并人格模型。

## Repository Map

- `index.html`, `styles.css`：当前可直接打开的 H5 / 产品原型页面。
- `nnz-mvp/`：TypeScript MVP，实现 Soul 作用域、Memory Vault、Covenant 状态机、Soul 更新提案、Soul Ops 成熟度报告和安全护栏。
- `CLAUDE_CODE_HANDOFF.md`：给 Claude Code / 其他 AI 的整体交接说明。
- `nnz-mvp-CURRENT-STATE.md`：当前实现状态与下一步建议。
- `nnz-mvp-*.md`：各阶段实施记录与交接文档。
- `.agents/skills/`：本项目的 AI 协作规则，约束产品、架构与前端实现。


## Cloud Demo

```text
https://nnz-kego.onrender.com
```

## Local Verification

```bash
cd nnz-mvp
npm install
npm run typecheck
npm test
npm run build:demo
npm run demo
```

`npm run demo` 会启动本地双用户并排聊天 / Soul Ops 演示页面，用于验证不同用户不同 Soul、纠正提案、节点记忆隔离和安全护栏。
