# Turn Token Usage — 技术设计

## 设计版本

| 日期 | 版本 | 说明 |
| --- | --- | --- |
| 2026-09-01 | v1 | 当前回合 observed usage 的受控投影、累计与展示 |
| 2026-09-01 | v2 | mandatory all-zero placeholder 失败关闭为 unavailable |

## 项目架构

- 架构类型: npm workspace monorepo；BYZ CLI/TUI 产品层。
- 涉及层: Pi Adapter capability facade、BYZ Conversation extension、Node test/TUI smoke。
- 设计基准: 复用 Conversation Shell 的结构级终端基准，不新增视觉资产。

## 波及面

- `packages/byz/src/adapters/pi/pi-runtime-adapter.ts`：当前 Conversation facade 允许 `message_update`，但只投影 role；`agent_end` 不投影 usage。需要加入最小、安全的 usage 投影，不暴露原始消息或 Provider payload。
- `packages/byz/src/application/ports/runtime.ts`：如现有 Conversation event 类型不能表达 bounded usage，补充最小结构类型；不得扩展成完整 Pi API。
- `packages/byz/src/conversation/conversation-extension.js`：当前 Footer 已从 Session entries 计算累计 usage，working message 和完成摘要只显示时间。新增 turn-scoped accumulator，并复用现有 `formatTokens`。
- `packages/byz/test/conversation.test.mjs`：增加当前回合累计、重复 update 去重、多响应、缺失/非法 usage、结束清理和 80 列文案回归。
- `packages/byz/test/architecture.test.mjs`：如 capability surface 变化，固定仅允许数值 usage 投影，禁止 raw message/context 逃逸。
- `scripts/byz-packed-runtime.test.mjs`：只在现有 packed TUI fixture 可低成本扩展时增加可见 Token 断言；不得调用真实 Provider。

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

复用现有 `formatTokens`，不新增第二套数量格式：

- 尚未 observed，或仅收到 mandatory all-zero placeholder：`Token —`。
- 已 observed：`Token ↑12.4k · ↓860`；输入或输出字段缺失时只显示已观测字段。
- 完成摘要：在耗时通知中增加独立 usage 句，按 `输入；输出；缓存读取；缓存写入` 顺序显示。可选缓存字段缺失时省略；已由同一 payload 正值建立 presence 的零字段显示为 `0`，unknown 显示 `—`。
- 中文和英文文案分别位于现有固定文案表，不把 Provider/model 名称写入显示。

现有 1 秒 interval 调用 `publishWorking()` 时只读取 turn accumulator 的 O(1) snapshot。usage 事件仅在数值发生变化或完成提交时触发一次 working-message 更新；streaming 文本 delta 不额外重绘。

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

message_update -> { message: { role, usage? } }
message_end    -> { message: { role, usage? } }
agent_end      -> { usage? }
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
| 依赖 | 零新增 | 现有 Pi usage 与格式化能力足够 |
