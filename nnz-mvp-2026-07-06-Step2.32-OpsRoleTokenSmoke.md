# 2026-07-06 Step 2.32 Ops Role Token Smoke CLI

## 目标

补齐 Render 角色化 Ops token 的受保护 smoke 入口，让 viewer/operator/admin 权限边界可以用同一个命令验证，而不是手工 curl。

这一步只属于后台/运维验证面，不进入用户前台，不改变 Soul runtime 行为。

## 实现

新增：

```text
nnz-mvp/src/tools/ops-role-token-smoke-cli.ts
nnz-mvp/src/tools/ops-role-token-smoke-cli.test.ts
```

`package.json` 新增：

```text
npm run ops:role-smoke
```

默认命令：

```bash
npm run ops:role-smoke -- --base-url https://nnz-kego.onrender.com --confirm RUN_OPS_ROLE_TOKEN_SMOKE
```

默认读取本地 shell env：

```text
NNZ_OPS_VIEWER_TOKEN
NNZ_OPS_OPERATOR_TOKEN
NNZ_OPS_ADMIN_TOKEN
```

也支持自定义 env key：

```bash
npm run ops:role-smoke -- --base-url https://nnz-kego.onrender.com --viewer-token-env NNZ_OPS_VIEWER_TOKEN --operator-token-env NNZ_OPS_OPERATOR_TOKEN --admin-token-env NNZ_OPS_ADMIN_TOKEN --confirm RUN_OPS_ROLE_TOKEN_SMOKE
```

默认验证：

- no token 访问 `/api/ops/overview` 返回 401。
- invalid token 访问 `/api/ops/overview` 返回 403。
- viewer 可以读 overview 和 audit query。
- viewer 不能 cleanup dry-run。
- operator 可以 cleanup dry-run。
- operator 不能 confirmed delete。
- admin 可以 cleanup dry-run。
- admin delete 在缺少服务端确认码时被拒绝。

可选破坏性验证：

```bash
npm run ops:role-smoke -- --base-url https://nnz-kego.onrender.com --include-delete --delete-confirm RUN_OPS_ROLE_TOKEN_DELETE_SMOKE --confirm RUN_OPS_ROLE_TOKEN_SMOKE
```

只有同时传 `--include-delete` 与 `--delete-confirm RUN_OPS_ROLE_TOKEN_DELETE_SMOKE` 时，才会向服务端发送 `dryRun:false` 和 `confirm:"DELETE_TEST_USERS"`。

## 安全边界

- 默认模式非破坏性，不执行 confirmed cleanup deletion。
- 真删除 smoke 需要第二道显式确认。
- stdout 只输出 baseUrl、deleteMode、token env 名称和固定 check 名称。
- stderr 只输出固定失败文案，可附带 `httpStatus` / `errorCode`。
- 不打印 token 值、response payload、用户内容、cleanup receipt、数据库 URL、server log 或 raw network details。
- 该 CLI 是 admin/developer protected verification，不属于用户前台功能，不引入用户可见机制文案。

## 验证

本地已通过：

```text
npm run typecheck
npm test -- src/tools/ops-role-token-smoke-cli.test.ts --reporter verbose
npm run ops:role-smoke -- --help
```

全量已通过：

```text
npm test
npm run build:demo
git diff --check
```

全量测试数：30 个测试文件 / 190 tests passed，另有 2 个 opt-in Postgres integration 文件 skipped。

## 后续

真实 Render role token smoke 仍需要：

- Render 已配置 `NNZ_OPS_VIEWER_TOKEN` / `NNZ_OPS_OPERATOR_TOKEN` / `NNZ_OPS_ADMIN_TOKEN`。
- 本地 shell 中临时注入同名 env 值。
- 用 `ops:role-smoke` 先跑默认非破坏性模式。

确认有可清理 smoke/test 账号且需要验证 deletion path 时，再跑 `--include-delete` 模式。
