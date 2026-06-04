# nnz-mvp 自动化提取管线 — 交接文档

> 日期：2026-06-03
> 前置：CURRENT-STATE.md（必读，了解项目架构）
> 目标：实现「对话 → LLM 结构化提取 → 置信度计算 → Proposal 生成」管线

---

## 一、当前状态：管线后半段已就位，前半段空白

现有代码已经有：

| 能力 | 位置 | 状态 |
|:---|:---|:---|
| Memory 分层（source / sensitivity / enabledForSoulUpdate 等 13 字段） | `types.ts` + `soul-store.ts` | ✅ 完整 |
| SoulUpdateProposal 审核流（create / accept / reject / evidence） | `soul-store.ts` | ✅ 完整 |
| fieldPath 白名单（只允许 `affectModel.humorLevel` 等三个路径） | `soul-store.ts` | ✅ 完整 |
| evidence 鉴权（必须来自 `listSoulUpdateMemory`，拒绝 NODE_MEMORY 和 RISK） | `soul-store.ts` | ✅ 完整 |
| Soul Maturity 评估（六维 + 推荐生成） | `soul-store.ts` | ✅ 完整 |

**缺失的是前半段**：从对话中自动提取结构化人格特征，计算置信度，生成 Proposal。Soul.md §3 定义了完整算法，但一行代码都没写。

## 二、为什么必须先搭 LLM 调用基础设施

提取管线需要 LLM 理解对话内容并输出结构化 JSON：

> Soul.md §3.2 示例：把对话片段送入 LLM，让它输出 `{adversity_response: "analyze", care_style: "action", emotional_awareness: "sensitive"}`

当前 `generateSoulReply` 是**确定性的**（正则匹配 → 硬编码文案），不"理解"内容，无法做特征提取。**所以提取管线在逻辑上依赖 LLM 调用能力。必须先有 LLM adapter，再搭提取管线。**

环境需求：
- 一个 LLM API key（OpenAI / Claude / 智谱 GLM 均可）
- API key 通过环境变量 `NNZ_LLM_API_KEY` 传入，`.gitignore` 排除 `.env`
- 选哪个模型影响不大——需要的是结构化 JSON 输出能力，不是高质量对话。GLM-4-Flash 级别就够
- 不需要向量数据库、不需要 RAG、不需要 embedding

## 三、推荐实现路径（分三步，约 400 行新代码）

### Step 1：LLM 调用基础设施（`src/llm/`）

新建目录，放两个文件：

**`src/llm/types.ts`** — 约 30 行

```ts
export interface LlmCompletionRequest {
  systemPrompt: string;
  userPrompt: string;
  temperature?: number;   // 提取任务建议 0.3，低温度保证输出稳定
  maxTokens?: number;
}

export interface LlmCompletionResponse {
  content: string;         // 原始文本
  parsed?: unknown;        // 如果要求 JSON 输出，这里放 parsed 结果
}
```

**`src/llm/adapter.ts`** — 约 60 行

```ts
// 当前只实现一个 provider（比如 OpenAI-compatible API）
// 接口设计为可替换：未来加 Claude / GLM 只需要实现同一个接口

export interface LlmAdapter {
  complete(request: LlmCompletionRequest): Promise<LlmCompletionResponse>;
}

// 具体实现：
export function createOpenAiCompatibleAdapter(config: {
  apiKey: string;
  baseUrl?: string;        // 默认 https://api.openai.com/v1
  model?: string;          // 默认 gpt-4o-mini
}): LlmAdapter

// 便捷包装：要求 JSON 输出，自动 parse 并校验
export async function completeStructured<T>(
  adapter: LlmAdapter,
  request: LlmCompletionRequest,
  schemaDescription: string  // 给 LLM 的 JSON schema 描述
): Promise<T>
```

关键决策：
- 不引入 LangChain 或任何 agent 框架——当前需求就是一次 HTTP 调用，太重了
- `completeStructured` 是核心工具：prompt 里要求 JSON 输出，拿到后 `JSON.parse`，失败重试一次
- adapter 实例通过 demo server 的 fixture 或独立模块级变量持有，不在 store 里

### Step 2：特征提取 prompt（`src/extraction/`）

新建目录：

**`src/extraction/prompts.ts`** — 约 60 行

提取用的 system prompt 模板。Soul.md 的规范要求提取以下维度：

```
人-己维度：self_perception, self_esteem, emotional_expressiveness
人-人维度：care_style, conflict_style, humor_level, emotional_awareness
人-事维度：adversity_response, help_seeking_style, pet_phrases
```

prompt 需要：
1. 告诉 LLM 它是人格分析工具，不是对话 AI
2. 要求只使用明确出现的证据，不要推测
3. 信息不足时输出 null，不要编造
4. 每个字段附带 evidence（引用原话）
5. 输出严格 JSON schema

**`src/extraction/types.ts`** — 约 40 行

```ts
// 单次提取结果中一个字段的输出
export interface ExtractionField {
  value: string | number | string[] | null;  // null = 信息不足
  confidence: number;                         // 由 LLM 给出初步置信度，后续确定性代码会重新计算
  evidence: string[];                         // 引用的原话片段
}

// 一次提取的完整输出
export interface ExtractionResult {
  selfPerception?: ExtractionField;
  selfEsteem?: ExtractionField;
  emotionalExpressiveness?: ExtractionField;
  careStyle?: ExtractionField;
  conflictStyle?: ExtractionField;
  humorLevel?: ExtractionField;
  emotionalAwareness?: ExtractionField;
  adversityResponse?: ExtractionField;
  helpSeekingGiving?: ExtractionField;
  helpSeekingSeeking?: ExtractionField;
  petPhrases?: ExtractionField;
}
```

**`src/extraction/confidence.ts`** — 约 50 行，确定性置信度计算

Soul.md §3.3 规定置信度计算是确定性代码，不能靠 LLM：

```ts
// 来源权重：用户主动描述 0.8 > 聊天记录推断 0.5
// 证据数量：≥3 次不同场景 → +0.2
// 一致性：和已有 Memory 一致的 → +0.1；冲突的 → 取高并 -0.1
// 最终 = min(1.0, 基础分 + 增益)
// ≥0.7 进正式字段并生成 Proposal；<0.7 写 Memory 但 enabledForSoulUpdate=false
```

### Step 3：编排器（`src/extraction/orchestrator.ts`）— 核心，约 150 行

这个文件是管线的中枢，解决五个编排问题：

```ts
export interface ExtractionOrchestrator {
  // 每次对话后调用，判断是否需要触发提取
  maybeExtractAndPropose(
    scope: UserPersonaScope,
    store: InMemorySoulStore,
    adapter: LlmAdapter,
  ): Promise<SoulUpdateProposal[]>;
}
```

**触发时机判断（问题一）**

```ts
function shouldTriggerExtraction(scope, store): boolean {
  // 条件：每 5 轮新对话触发一次（可配置）
  // 或者已有 PENDING proposal 时跳过（避免冲突）
  // 返回 false 则什么都不做
}
```

**去重追踪（问题二）**

在当前 store 的 `RuntimeSession` 中加一个字段：
```ts
lastExtractionMessageIndex?: number  // 上次提取时处理到的最后一条消息 index
```

每次提取后更新，下次从这之后开始取对话窗口。同一个对话片段不会被重复提取。同时检查是否有同 fieldPath 的 PENDING proposal，有则跳过。

**置信度合并（问题三）**

```ts
function mergeWithExisting(
  extracted: ExtractionResult,
  existingMemories: MemoryItem[],
  existingProposals: SoulUpdateProposal[],
): MergedField[]   // 每个 field 输出：{ fieldPath, value, finalConfidence, shouldPropose }
```

和已有的 CORRECTION / DESCRIPTION / CHAT_EXCERPT 类型 Memory 做一致性判断。Soul.md 的规定：
- 多个来源结论一致 → 置信度 +0.2
- 冲突 → 取高置信度来源，降低 0.1
- 如果已有 PENDING proposal 操作同一 fieldPath，不生成新 proposal

**阈值门控（问题四）**

```ts
if (merged.confidence >= 0.7) {
  // 1. 更新或创建 Memory（enabledForSoulUpdate=true, confidence=merged.finalConfidence）
  // 2. 创建 SoulUpdateProposal（status=PENDING, evidenceIds=[memory.id]）
} else {
  // 创建 Memory（enabledForSoulUpdate=false, 不进 proposal）
}
```

**作用域锁（问题五）**

提取全程在 scope 内运行——取对话用 `store.listConversations(scope)`，写 Memory 和 Proposal 走 `store.addMemory(scope, ...)` 和 `store.createSoulUpdateProposal(scope, ...)`。现有 store 的 `requireScope` 保证了跨 scope 写入会被拒绝，天然安全。

## 四、不引入的东西（不要因为"完善"而过度设计）

- **不要引入 LangChain / agent 框架** — 当前就是一次 HTTP 调用，不需要编排框架
- **不要引入向量数据库** — Memory 数量在 MVP 阶段不会超过 prompt 窗口
- **不要引入任务队列（Celery/Redis）** — 提取同步执行即可。把"触发检查"和"执行提取"写成两个可拆分函数，将来异步化时只需改调用方式
- **不要引入 RAG / embedding 检索** — 提取用的是最近的对话窗口，不需要语义检索
- **不要引入复杂的 JSON schema 校验库（zod 等）** — TypeScript 类型 + try-catch parse 在 MVP 阶段完全够用
- **不要在提取时修改 SoulVersion** — 提取只生成 Memory + Proposal，Soul 的实际更新走 `acceptSoulUpdateProposal`（现有流程不变）

## 五、文件与改动清单

| 文件 | 操作 | 预计行数 |
|:---|:---|:---|
| `src/llm/types.ts` | 新建 | ~30 |
| `src/llm/adapter.ts` | 新建 | ~60 |
| `src/extraction/types.ts` | 新建 | ~40 |
| `src/extraction/prompts.ts` | 新建 | ~60 |
| `src/extraction/confidence.ts` | 新建 | ~50 |
| `src/extraction/orchestrator.ts` | 新建 | ~150 |
| `src/extraction/orchestrator.test.ts` | 新建 | ~80 |
| `src/domain/types.ts` | 修改：RuntimeSession 加 `lastExtractionMessageIndex` | +3 行 |
| `src/demo-server.ts` | 修改：`sendMessageToBothUsers` 末尾调用 `maybeExtractAndPropose`；`createFixture` 注入 adapter | +15 行 |
| `src/domain/soul-store.ts` | **不改** — 现有接口已完全满足提取需求 |
| `src/runtime/soul-runtime.ts` | **不改** |
| `src/runtime/soul-guard.ts` | **不改** |

## 六、验收标准

1. **端到端跑通**：用户在 demo 里连续聊天 5 轮 → 系统自动触发提取 → LLM 返回结构化特征 → 置信度 ≥0.7 的特征自动生成 Proposal → 出现在 demo UI 的 proposal 面板中
2. **去重有效**：同样的对话片段不会产生重复的 Proposal
3. **阈值生效**：置信度 <0.7 的特征只存 Memory 不生成 Proposal
4. **作用域隔离**：A 的对话提取结果不出现在 B 的 scope
5. **Proposal 白名单不变**：提取出的 fieldPath 如果不在 `['affectModel.humorLevel', 'languageModel.petPhrases', 'identityCore.relationship']` 中，`createSoulUpdateProposal` 会自动拒绝（现有逻辑）
6. **测试通过**：新增约 8 条 orchestrator 测试（触发判断、去重、置信度合并、阈值门控），整体约 45 条测试全绿

## 七、环境准备（给下一个 AI 的操作步骤）

1. 获取 LLM API key（OpenAI / 智谱 GLM / 任何 OpenAI-compatible 的 API）
2. 在 `nnz-mvp/` 目录下创建 `.env` 文件（已被 `package.json` 的 `.gitignore` 或手动创建）
3. `.env` 内容：`NNZ_LLM_API_KEY=sk-xxx` + 可选的 `NNZ_LLM_BASE_URL` 和 `NNZ_LLM_MODEL`
4. 在 demo server 启动时读取 `.env` 并创建 adapter 实例
5. 如果要测试而不依赖真实 LLM，可以先用 mock adapter（返回固定 JSON）跑通编排逻辑，再换真实 API

## 八、与现有模块的关系图

```
用户发消息
  │
  ▼
demo-server sendMessageToBothUsers()
  ├── applySafetyGuard()          ← soul-guard.ts（安全护栏，已有）
  ├── getRuntimeContext()         ← soul-store.ts（covenant 状态，已有）
  ├── generateSoulReply()         ← soul-runtime.ts（回复生成，已有）
  ├── addConversation()           ← soul-store.ts（记录对话，已有）
  └── maybeExtractAndPropose()    ← NEW 编排入口
        ├── shouldTriggerExtraction()     ← NEW 触发判断
        ├── buildExtractionContext()      ← NEW 组装对话窗口
        ├── adapter.complete()            ← NEW LLM 调用
        ├── prompts.parseExtraction()     ← NEW 解析 JSON 输出
        ├── confidence.mergeWithExisting()← NEW 置信度合并
        ├── store.addMemory()             ← 已有，写入 Memory
        └── store.createSoulUpdateProposal()← 已有，生成 Proposal
```

新代码全部在 `src/llm/` 和 `src/extraction/` 两个目录下，**不修改 soul-store、soul-runtime、soul-guard 的核心逻辑**。只有 `types.ts` 加一个字段、`demo-server.ts` 加调用链末端的一个 hook。

---

**给下一个 AI：先读 `nnz-mvp-CURRENT-STATE.md`（项目全景），再读本文档（管线规格），然后从 Step 1（`src/llm/`）开始搭，不必担心破坏现有逻辑。**
