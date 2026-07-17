# nnz-mvp 2026-07-17 H5 Chat Upload + WeChat Bot Bridge

## 用户决策

2026-07-17 用户明确下一阶段路线：

1. 先用 H5 / Web App 做内测。
2. H5 内测支持上传聊天记录文件，并明确用户可提交的文件格式。
3. 建立一套通过微信机器人的接入流程，并和当前服务打通。
4. 暂不做“微信缺口评估”，直接执行微信机器人桥接。

## 本次实现

### H5 聊天记录上传

- 新增 `src/chat-record-import.ts`。
- H5 “补充记忆”面板新增聊天记录文件导入入口。
- 推荐用户提交 UTF-8 `.txt`：
  - 一行一条消息。
  - 推荐格式：`说话人：内容`。
- 同时支持 `.json`：
  - 根对象含 `messages` 数组，或文件本身是消息数组。
  - 每条消息可使用 `speaker` / `sender` / `name` / `role` 和 `text` / `content` / `message`。
- 新增 `POST /api/me/chat-upload`：
  - 需要登录。
  - 必须传当前用户自己的 `personaId`。
  - 通过 `requireUserPersonaRuntime(res, authUser.userId, personaId)` 进入 scoped runtime。
  - 上传内容写入 `CHAT_EXCERPT` memory，`source: 'UPLOAD'`，`sensitivity: 'MEDIUM'`。
  - API 只返回导入条数、格式、截断状态和 memory id，不返回导入原文。

### 微信机器人桥接

- 新增 `NNZ_WECHAT_BOT_TOKEN`。
- H5 新增 “微信接入” 按钮。
- 新增 `POST /api/me/wechat-bot-link`：
  - 需要登录。
  - 为当前用户选中的 persona 生成 30 分钟一次性链接码。
  - 返回用户可发给机器人的指令，例如 `向微信机器人发送：绑定 XXXX`。
- 新增机器人侧接口：
  - `POST /api/wechat-bot/link`
  - `POST /api/wechat-bot/message`
- 机器人侧接口必须携带 `x-wechat-bot-token` 或 `Authorization: Bearer <token>`。
- `/api/wechat-bot/link` 用 `externalUserId + linkCode` 完成绑定。
- `/api/wechat-bot/message` 用 `externalUserId + message` 调用同一套 `sendMessageToUserPersona()` scoped runtime。
- 机器人侧响应只返回 reply 和可展示的 persona 信息，不返回内部 `userId` / `personaId`。

## 当前边界

- 当前微信机器人 binding 是进程内 Map，适合内测打通；正式环境需要持久化绑定表或正式微信 OAuth 身份链路。
- 当前不是微信 OAuth / 服务号完整生产接入。
- 当前不依赖个人微信自动化库；任何机器人进程只要能调用 HTTP，就可以桥接到 `/api/wechat-bot/*`。
- 不改变 `userId + personaId` 作用域规则。
- 不把上传的聊天记录原文写入日志、文档或响应。

## 验证

本地已通过：

```text
npm test -- src/chat-record-import.test.ts src/demo-server-consent.test.ts src/h5-experience.test.ts
npm run typecheck
```

## 后续建议

1. 配置 `NNZ_WECHAT_BOT_TOKEN` 到内测环境。
2. 选定实际机器人进程，让它解析用户消息：
   - `绑定 XXXX` -> 调 `/api/wechat-bot/link`
   - 普通消息 -> 调 `/api/wechat-bot/message`
3. 内测中优先观察 H5 上传文件是否足够简单、机器人绑定是否容易理解。
4. 正式环境前把微信机器人 binding 从进程内 Map 升级为持久化 scoped 绑定。

## 建议 push Summary

```text
feat: add h5 chat upload and wechat bot bridge
```
