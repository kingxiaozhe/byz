# Structured Execution Registry — 技术设计

## 设计版本

| 日期 | 版本 | 说明 |
| --- | --- | --- |
| 2026-09-02 | v1 | 初始设计 |

## 项目架构

- 架构类型: npm workspace monorepo；BYZ product layer 通过 closed Pi Adapter 使用 extension runtime。
- 涉及层: BYZ execution registry、application ports、Pi runtime adapter、Conversation extension、Session custom entries、Node tests/TUI smoke。
- UI 基准: 复用 Conversation Shell 结构级终端基准；只增加可省略的单行步骤字段和完成证据摘要。

## 波及面

- `packages/byz/src/conversation/conversation-extension.js`：消费只读 registry snapshot，在现有单行状态和完成摘要中追加可信 counts；无 registry 时必须逐字保持现状。
- `packages/byz/src/adapters/pi/pi-runtime-adapter.ts`：新增专用 execution capability，封闭投影 `registerTool`、tool lifecycle、Session custom entry append/read；不得把完整 Pi API 或 Session message 暴露给 BYZ Core。
- `packages/byz/src/application/ports/runtime.ts`：增加 registry 所需的 plain-data port；继续保持 framework-independent。
- `packages/byz/src/cli.js`：组合单例 registry service、registry extension 与 conversation consumer。
- `packages/coding-agent/src/core/extensions/**`：优先复用现有 `registerTool`、`appendEntry`、tool events；只有现有 managed facade 无法安全投影时才做最小公开 API 补充。
- `packages/byz/test/conversation.test.mjs` 与新增 registry focused test：回归现有状态，并覆盖 reducer/replay/provenance。
- Feature 5/6：只依赖冻结 snapshot 和 transition API，不直接依赖 Pi。

## 功能模块设计

### 1. Closed registry reducer

新增 `packages/byz/src/execution/execution-registry.js`，导出纯内存 service。所有改变都走：

```text
validate envelope → validate generation/sequence → propose transition without mutation → append receipt → commit state → publish frozen snapshot
```

Session append 是 accepted transition 的 durability linearization point。`appendEntry` 抛错时丢弃 proposal，内存状态和 subscriber 均不变化；replay 模式只 reduce 已持久 receipt，不再次 append。

边界常量：tasks ≤64、receipts ≤128、ID 1–64 个 `[A-Za-z0-9._-]` 字符、label 清理后 ≤120 字符。计数使用 safe integer。host 生成 `planId` 和 generation；调用者不能覆盖。

计划状态：

```text
empty → drafting → sealed → terminal
                 ↘ unavailable
```

任务状态：

```text
pending → active → completed
                 → blocked → active
                 → cancelled
```

- drafting 只允许定义任务；seal 后任务集合和顺序不可变。
- 同时最多一个 active task。重复同值 transition 幂等；非法迁移返回 closed error code，不修改状态。
- unavailable 是候选计划的失败关闭终态；只能显式 `plan_open` 创建新 generation，不能修补损坏历史。
- snapshot 使用深冻结 plain object，包含 plan state、total、active ordinal、completed/blocked/cancelled counts、provenance counts 和 generation，不暴露内部 Map/Set。

### 2. Managed execution tool

新增 BYZ managed tool `byz_execution`，参数采用单一 discriminated action：

```text
plan_open    { tasks: [{ id, label? }] }
plan_seal    { planId }
task_start   { planId, taskId }
task_finish  { planId, taskId, outcome: completed|blocked|cancelled }
task_resume  { planId, taskId }
evidence_add { planId, taskId, kind, basis }
```

Adapter 注册真实 Pi tool/schema，execute 时只向 registry 传递通过 schema 的 bounded plain data。tool result 只返回 accepted/error code、planId 和安全 counts，不回显 label 或 Session 内容。

`plan_open` 原子创建 drafting plan 与全部任务，避免部分 upsert 形成“已知 total”的假象；`plan_seal` 独立动作让调用者确认计划不再扩展。系统提示只说明何时使用 tool，不把自然语言解析作为 fallback。没有调用 tool 就没有 Tasks。

### 3. Provenance and observed evidence

registry extension 监听 bounded `tool_execution_start/end`：

- start 时冻结当时唯一 active task 关联，按 stable toolCallId 建 in-flight receipt。
- end 只匹配一次；保存 `{toolCallId, category, outcome, taskId, sequence}`，不保存 args/result。
- category 固定为 `inspect|mutation|command|other`。
- 对 bash/powershell input 只做 ephemeral allowlist classifier，输出 `test|check|build|git|generic`；原命令不进入 registry 或 Session。
- `observed` 表示运行时看到了 start/end。classifier 命中且 matched end 成功只得到 categorized observed receipt，不能显示“测试通过”。
- `verified` 只接受 runtime-owned formal test event，或来源 allowlist、run/generation、task、test contract 和 outcome 均可验证的可信 workflow receipt；该接入口若本任务没有真实权威事件则保持关闭。
- `evidence_add` 默认只产生 declared receipt；`basis: latest_observed` 只能关联/消费同 task、同 generation、未消费且类型兼容的 observed receipt，不能升级为 verified。模型文字不能升级 provenance。

并行工具在 start 时各自绑定 task；task 在有 in-flight receipt 时不得 finish，以免归属漂移。

### 4. Session receipt store and replay

通过专用 `ExecutionSessionPort` 使用现有 Pi `appendEntry(customType, data)`，custom type 固定 `byz.execution.v1`。每条 transition 先形成 immutable proposal/receipt，Session append 成功后才提交内存状态并通知消费者：

```text
{ schemaVersion:1, sequence, generation, planId, action, bounded payload, provenance }
```

entry 不进入 LLM context。session_start/resume/reload 从 Adapter 只读投影的同 custom type entries 重放；Adapter 不返回普通 messages 或其他 custom entries。

replay 规则：schema、sequence、generation、ID、transition、limits 全部验证；任一记录损坏则当前 generation unavailable，继续有界扫描只用于诊断计数，不能采用后续“完成”覆盖损坏。重复完全相同 sequence 幂等；冲突 duplicate 失败关闭。

### 5. Conversation integration

`createConversationExtension({ executionRegistry })` 只读取 `snapshot()`：

- compact：sealed + unique active + valid ordinal 时，在工具字段前追加 `步骤 N/T`；否则省略。
- completion：sealed 时可追加 `完成 C/T`、非零 blocked 和 verified evidence；不显示 label、percentage 或 generic tool success。
- registry unavailable 只在 explicit details 显示固定 reason code；默认 compact 不输出原记录/字段。
- registry snapshot 变化触发一次现有 working message redraw，不新增 timer。

Turn Token Usage 的 stage、tool count、Token、timing 仍由自身结构化事件决定；registry 不能覆盖 execution selector。

### 6. Consumer boundary

Feature 5/6 只拿到：

```text
ExecutionRegistrySnapshot
subscribe(listener): Disposable
```

Mutation API 仅 registry extension/tool adapter 持有。Delivery 所需 mutation paths 不在 v1 registry 通用 receipt 中暴露；后续 Feature 6 必须通过单独受审的 trusted-project projection 扩展，不得预埋 raw args。

## 接口契约

```text
ExecutionSnapshot = {
  availability: empty|available|unavailable
  generation: non-negative safe integer
  plan?: {
    id: bounded string
    state: drafting|sealed|terminal
    total?: 1..64
    active?: { id, ordinal }
    counts: { completed, blocked, cancelled, declaredEvidence, observedEvidence, verifiedEvidence }
  }
  reasonCode?: closed enum
}
```

Adapter 新端口只允许：注册 `byz_execution`、监听 projected tool start/end 和 session lifecycle、append/read `byz.execution.v1` entries。任何未在 allowlist 的 command/event/custom type 抛错。

## 数据模型

- 内存：一个 current plan、task Map、ordered IDs、in-flight tool Map、bounded receipts、sequence/generation。
- 持久化：现有 Session transcript custom entries；无新文件、数据库或全局状态。
- 不存储：Prompt、response、命令、参数、路径、tool result、error text、Provider payload、凭据。

## 安全考虑

- Tool 输入视为不可信；schema 校验后仍执行长度、字符、状态和 generation 校验。
- Session replay 是不可信数据读取；严格 schema + fail closed。
- 默认 renderer 不消费 label。details 如显示 label，先做控制字符清理且不显示绝对路径形态。
- classifier 只输出固定 category，绝不保存或回显原命令。
- 本模块是事实注册表，不是权限系统；不能授权工具或远端副作用。

## 技术决策

| 决策 | 选择 | 理由 |
| --- | --- | --- |
| 任务来源 | managed structured tool | 不解析自然语言；有明确 schema 和调用证据 |
| total 可信门槛 | 原子 plan_open + explicit seal | 防止计划仍扩展时显示假总量 |
| 状态存储 | Session custom entries | 同 Session 可恢复，不建项目/全局第二状态源 |
| provenance | declared/observed/verified 三态 | classifier 只分类 observed；只有 runtime/formal workflow receipt 能 verified |
| transition 原子性 | propose → Session append → commit/publish | append 失败不能留下 reload 后消失的幽灵状态 |
| tool 证据 | toolCallId + fixed category | 支持并行乱序且不保存敏感 payload |
| UI | 可省略 `步骤 N/T`，无百分比 | 只有可靠 ordinal/total 才展示 |
| consumer | frozen snapshot | Pause/Delivery 不得绕过 reducer 改事实 |
| 依赖 | 零新增 | 现有 extension tool、events、Session entries 足够 |
