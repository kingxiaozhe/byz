# Turn Token Usage — 技术设计

## 设计版本

| 日期 | 版本 | 说明 |
| --- | --- | --- |
| 2026-09-01 | v1 | 当前回合 observed usage 的受控投影、累计与展示 |
| 2026-09-01 | v2 | mandatory all-zero placeholder 失败关闭为 unavailable |
| 2026-09-02 | v3 | 单行执行状态、in-flight tools 与 BYZ 模型活跃时间摘要 |

## 项目架构

- 架构类型: npm workspace monorepo；BYZ CLI/TUI 产品层。
- 涉及层: Pi Adapter capability facade、BYZ Conversation extension、Node test/TUI smoke。
- 设计基准: 复用 Conversation Shell 的结构级终端基准，不新增视觉资产。

## 波及面

- `packages/byz/src/adapters/pi/pi-runtime-adapter.ts`：v1/v2 已完成 bounded usage 投影；v3 复用现有 `toolCallId`、`toolName`、`isError` 与 usage projection，不扩大 capability surface。
- `packages/byz/src/application/ports/runtime.ts`：如现有 Conversation event 类型不能表达 bounded usage，补充最小结构类型；不得扩展成完整 Pi API。
- `packages/byz/src/conversation/conversation-extension.js`：v3 修改紧凑 renderer、状态优先级和 turn-scoped 工具统计；继续复用现有 usage accumulator、每秒刷新、progress timeout 与 Footer。
- `packages/byz/src/conversation/turn-timing.js`：保持 monotonic active/waiting 核心合同；通过封闭 stage 投影计算模型活跃时间，不新增计时器。
- `packages/byz/test/conversation.test.mjs`：保留 usage、Footer 和生命周期矩阵，新增 2 秒延迟、单行状态、并行工具配对、模型活跃时间、完成摘要和中英文回归。
- `packages/byz/test/architecture.test.mjs`：如 capability surface 变化，固定仅允许数值 usage 投影，禁止 raw message/context 逃逸。
- `scripts/byz-packed-runtime.test.mjs`：只在现有 packed TUI fixture 可低成本扩展时增加可见 Token 断言；不得调用真实 Provider。

## v3 增量设计：执行状态可观测性

### 状态来源与优先级

默认执行文案只消费已有结构化事件，不读取模型自然语言或 tool payload。每个事件只更新 `waiting/recoverPending/replyActive/inFlightTools` 等底层信号；显示状态和计时 stage 必须由同一个纯 selector 派生，禁止事件 handler 直接覆盖当前 stage：

```text
confirmation presenter waiting
  > inFlightTools.size > 0
  > recover/error state
  > model-active state
  > reply state
  > complete
```

实现顺序为“更新信号 → 调 selector → 仅在 selected stage 变化时 transition/render”。因此 assistant update、重复事件和无 ID 事件在合法工具仍运行时都不能离开 tool stage。

固定状态词表：

| 状态 | 中文 | English | 数据源 |
| --- | --- | --- | --- |
| think | BYZ 思考中 | BYZ is thinking | agent/model-active interval |
| inspect | 核对中 | Checking | read/grep/find/ls tool start |
| modify | 修改中 | Editing | edit/write tool start |
| command | 执行中 | Running | bash/powershell tool start |
| recover | 处理异常 | Recovering | matched tool end with error |
| reply | 整理答复 | Preparing reply | assistant message update |
| waiting | 等待确认 | Waiting for confirmation | confirmation presenter |

不提供百分比，不显示 Tasks。当前 CM specs task 数是项目工作流事实，不能作为当前 Agent turn 的 runtime task 数。

### 工具配对与统计

Conversation extension 在每个 turn 内维护：

```text
inFlightTools: Map<toolCallId, { category, sequence }>
startedToolIds: Set<toolCallId>
endedToolIds: Set<toolCallId>
toolCalls: non-negative safe integer
toolFailures: non-negative safe integer
```

- 只接受非空字符串 `toolCallId`；无可靠 ID 的 start/end 对工具 Map、统计、selected stage 和 timing 都不产生影响。
- 首次 start 加入 in-flight 并把累计调用数加一；重复 start 不重复计数。
- 匹配 end 才移出 in-flight；重复或未知 end 不改变数量，绝不出现负数。
- 并行工具按 Map 当前 size 展示；任一结束后仍有其他工具时，selector 继续选择 tool stage。
- assistant update 只设置 `replyActive` 信号；合法工具仍在运行时 selector 保持 tool stage。
- 最后一个合法工具结束后，selector 才根据 `recoverPending > replyActive > think` 选择模型 stage。
- `agent_end` 与 `session_shutdown` 清空全部 turn-local 集合。

### 模型活跃时间

引入封闭 `think` stage，并复用 `createTurnTiming` 的 stage totals：

- `agent_start` 初始化 model-active 信号并由 selector 选择 `think`。
- 首个合法工具开始时 selector 切到对应工具 stage；并行工具不重复累计重叠 wall-clock。
- assistant update 只设置 reply 信号；in-flight 非空时 timing 仍保持工具 stage。
- 最后一个合法工具结束后，selector 才切到 `recover`、`reply` 或 `think`。
- 完成摘要中的 `modelActiveMs` 是 selector 实际选择的 `think + recover + reply` stage wall-clock 总和；工具 stage 与 confirmation waiting 明确排除。
- 该值只表示客户端观察到的模型活跃/生成区间，不声称读取 hidden chain-of-thought。

### 紧凑渲染与延迟

复用现有 progress timeout，将默认延迟改为 2 秒：

- 2 秒前不调用自定义 `setWorkingMessage`；短 turn 结束时只清理 timer，不闪现状态行。
- 2 秒后紧凑模式只发布一行，并由现有 interval 每秒刷新：

```text
BYZ 思考中 · 0分12秒 · Token 3.2k
执行中 · 2 个工具运行 · 1分12秒 · Token 8.4k
等待确认 · 0分11秒 · 已执行 1分31秒 · Token 14.2k
```

- Token headline 为安全的 observed `input + output`；缺失或相加溢出时为 `Token —`，cache 不进入 headline。
- `inFlightTools.size === 0` 时隐藏工具字段；等待确认优先于工具/模型状态。
- 详情模式是用户显式开启的既有能力，可继续展示经现有清理流程生成的目标、活动、边界、active/waiting 与分项 usage；默认紧凑 renderer 不消费 args/path/command，两种模式共用同一状态事实快照。

完成时固定两行：

```text
完成 · 1分56秒 · Token 12.8k
BYZ 思考了 0分42秒 · 工具 4 次 · 等待 0分11秒
```

工具或等待为零时省略对应字段；失败非零时追加 `（1 次失败）`。英文使用同一快照和结构，不建立第二套状态逻辑。

## 模块设计

### 1. Bounded usage projection

Adapter 定义单一 usage 投影函数，只接受以下字段：

```text
input · output · cacheRead · cacheWrite
```

每个字段必须是有限、非负且不大于 `Number.MAX_SAFE_INTEGER` 的整数。非法字段被省略；全部字段非法或缺失时返回 `undefined`。不投影 `cost`、Prompt、内容块、模型响应、headers 或 Provider payload。

Pi/Provider 的 mandatory usage 结构会用全零对象作为未提供 usage 的占位。当前接口没有独立 presence 信号，无法区分该占位与真实 standalone all-zero。按 observed-only 原则，投影只有在至少一个合法字段为正时才建立 payload observed presence；全零对象返回 `undefined`。一旦 payload 已由正值证明 observed，同一 payload 中其他显式合法的 `0` 保留为 observed zero。

聚合采用已建立的逐字段 presence，而不是零初始化所有字段：只有至少一条已证明 observed 的消息显式提供合法字段时，聚合结果才包含该字段。每次相加前检查 `Number.isSafeInteger(current + next)`，溢出时将该字段标记 invalid 并从本次聚合中省略，后续值不得让它重新变为有效。

Conversation event surface 增加：

- `message_update`: `{ message: { role, usage? } }`，用于在 Provider 已提前返回 usage 时替换当前响应快照。
- `message_end`: `{ message: { role, usage? } }`，将当前响应 usage 恰好提交一次。
- `agent_end`: `{ usage? }`，Adapter 从本次 Agent run 的新消息中聚合最终 observed usage，作为完成摘要的权威快照。

Adapter 内的 `agent_end` 聚合只消费 assistant/toolResult 消息的 bounded usage，返回合计数值，不返回 messages 数组。Conversation capability allowlist 必须显式加入 `message_end`，不开放其他 Pi 事件或上下文。

### 2. Turn-scoped usage accumulator

Conversation extension 创建与 turn timing 同生命周期的内存状态：

```text
committed usage + current response snapshot + observed flag
```

- `agent_start`: 创建空 accumulator，`observed=false`。
- `message_update`: 对 assistant 当前响应做 snapshot replace，不相加；只有 bounded usage 才设置 observed。
- `message_end`: 将当前响应提交一次并清空 current snapshot。若 message_end 是 toolResult，则直接提交其 bounded usage。
- 多次 streaming update 只更新 current snapshot，因此不会重复累计。
- `agent_end`: 若 Adapter 提供 run-level aggregate，则以该 aggregate覆盖增量状态，消除 event 缺失或顺序差异；aggregate 必须保留逐字段 presence 并使用相同 checked addition。否则使用已累计值。完成后冻结摘要并清理活动状态。
- 生命周期依据 Pi 的 agent contract：正常完成、Abort/取消和 Provider/Agent 异常都会以真实 `agent_end` 收口；实现不能只在成功消息存在时清理。集成测试必须通过 faux provider 的取消与错误路径观察该事件和清理结果，而不是手工调用 handler 冒充运行时保证。
- `session_shutdown`: 无论 `agent_end` 是否已经处理都幂等丢弃 accumulator，作为会话销毁兜底；下个 `agent_start` 总是从 unknown 开始。

Accumulator 不读取完整 Session，不写磁盘，不进入 diagnostics 或模型上下文。

### 3. Progress and completion rendering

复用现有 `formatTokens` 与 v3 状态快照，不新增第二套数量格式：

- 紧凑 headline：安全 observed `input + output` 总量；尚未 observed、mandatory all-zero 或 headline 相加溢出时为 `Token —`。
- 详情 usage：继续按 `输入；输出；缓存读取；缓存写入` 显示逐字段事实；cache 不进入 headline。
- 完成摘要：固定两行，使用 total、modelActive、toolCalls/toolFailures、waiting 和 Token headline；零值可选字段隐藏。
- 中文和英文文案分别位于现有固定文案表，不把 Provider/model 名称、toolName、args 或路径写入紧凑显示。

现有 1 秒 interval 只读取 turn timing、usage 与工具 Map 的 O(1) snapshot。tool/message 事件仅在状态、工具数量或 observed usage 变化时触发必要重绘；streaming 文本 delta 不额外重绘。

### 4. Footer compatibility

Footer 的 Session 累计逻辑保持现状：

- `↑/↓/R/W/$` 仍从 Session entries 计算。
- 当前回合 accumulator 不回写 Session，也不参与 Footer 计算，避免重复累计。
- Footer model、Thinking 和窄终端右侧优先级不变。

### 5. Verification

- 纯逻辑测试通过受控 event harness 驱动，不访问真实 Provider。
- 覆盖 unknown、mandatory standalone all-zero、mixed observed zero、单响应多 update、多响应、toolResult usage、部分字段、单值非法、累计溢出、agent_end presence-preserving override、真实取消/错误 agent_end 与 shutdown。
- 80 列断言同时检查阶段时间和 Token 行可读，不要求逐 Token 动画。
- 运行 focused Node test、`npm --prefix packages/byz test`、`npm run check`；如 packed fixture 变更，再运行隔离 HOME 的 packed-runtime 测试。

## 接口契约

```text
ProjectedUsage = {
  input?: non-negative safe integer
  output?: non-negative safe integer
  cacheRead?: non-negative safe integer
  cacheWrite?: non-negative safe integer
}

message_update      -> { message: { role, usage? } }
message_end         -> { message: { role, usage? } }
tool_execution_start -> { toolCallId?, toolName? }
tool_execution_end   -> { toolCallId?, toolName?, isError? }
agent_end            -> { usage? }
```

这些是 BYZ Conversation capability 的最小投影，不是公开完整 Pi message API。

## 数据模型

无持久化数据模型。所有数据仅存在于当前 Agent turn 的内存中。

## 安全考虑

- usage 只能是 closed-schema 数值，任何对象、字符串、非有限数或负数失败关闭。
- 不记录 Prompt、Response、路径、Provider payload 或错误文本。
- 不将 Token usage 写入 diagnostics、CM logs 或 Session 之外的新状态源。
- Token 数量不是费用；完成摘要不自行推算成本。

## 技术决策

| 决策 | 选择 | 理由 |
| --- | --- | --- |
| 展示口径 | Progress 为当前回合；Footer 为 Session 累计 | 同时回答“本轮用了多少”和“整个会话用了多少” |
| 实时语义 | Provider observed、按响应分段更新 | 跨 Provider 保持准确，不做 tokenizer 估算 |
| 去重 | current snapshot replace + message_end commit + agent_end aggregate override | 防 streaming 重复累计并对事件差异收口 |
| 聚合 | 正值建立 payload presence + mixed zero 保留 + checked safe-integer addition | mandatory all-zero 失败关闭，区分可证明的 observed zero，并防合法单值累计后溢出 |
| Adapter 边界 | 投影闭合数值，不暴露 messages | 保持 BYZ Core 与完整 Pi API 隔离 |
| 刷新 | 复用现有 interval，usage 变化时必要重绘 | 不增加 timer 或高频 streaming redraw |
| 依赖 | 零新增 | 现有 Pi usage、tool lifecycle 与格式化能力足够 |
| 默认状态形态 | 2 秒后单行；详情按需展开 | 短任务无闪烁，长任务保留可见进展 |
| 工具计数 | 只按稳定 toolCallId 配对 | 支持并行与乱序结束，不靠 toolName 猜数量 |
| BYZ 思考时间 | `think + recover + reply` 的客户端 wall-clock | 排除工具与人工等待，不冒充 hidden chain-of-thought |
| Tasks | v3 不显示 | 当前没有可靠 runtime task registry，CM tasks 不是 turn tasks |
