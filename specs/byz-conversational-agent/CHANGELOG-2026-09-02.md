# 变更日志 — 2026-09-02

> base-commit: dcf3c504f5483dd1b20ac04a68663ef32ae648b9

## Feature 1: Conversation Shell

本轮无独立 feature 变更；Turn Token Usage v3 复用其详情模式、Footer、语言偏好、confirmation presenter 和 monotonic turn timing。

## Feature 2: Routing Preferences

本轮无变更。

## Feature 3: Turn Token Usage v3

### 新增

- 运行超过两秒后显示单行结构化状态、本轮总耗时、observed Token headline 和非零 in-flight 工具数量。
- 完成时固定两行显示总耗时、Token、客户端观察到的 BYZ 模型活跃时间、工具/失败次数和非零人工等待。
- 工具按稳定 `toolCallId` 配对，支持并行、乱序、重复、未知和缺失 ID 的失败关闭。
- timeout、interval 和异步 confirmation continuation 绑定 turn generation，旧回合回调不能污染新回合。

### 变更

- 默认紧凑进度从多行活动卡改为延迟单行；显式 details 继续保留经清理活动信息和 usage 分项。
- Token headline 改为安全的 observed `input + output`；cache 不进入 headline，Footer 继续保持 Session 累计。
- “BYZ 思考”定义为客户端 model-active wall-clock，不包含工具执行、人工等待或 hidden chain-of-thought。
- v3 不显示 Tasks 或推测进度百分比。

### 关键文件

- `packages/byz/src/conversation/conversation-extension.js` — signal selector、工具配对、状态渲染、完成摘要和 generation guard。
- `packages/byz/test/conversation.test.mjs` — 延迟、并行工具、Token、计时分账、跨回合回调、双语、安全边界和真实 AgentSession 回归。
- `packages/byz/README.md` — 用户可见执行状态与口径说明。
- `packages/byz/CHANGELOG.md` — Unreleased 产品变更。

### 架构决策

- 默认 renderer 只消费结构化状态快照，不解析模型自然语言或 tool payload。
- 只有合法 `toolCallId` 能改变工具 Map、累计和 timing stage。
- 一个纯 selector 同时决定显示和 timing stage，防止事件 handler 产生不同事实。
- 旧回合所有延迟 continuation 在读取共享状态前校验 generation。

### 验证

- Focused Conversation + architecture：40/40 通过。
- BYZ package：216 通过，1 项平台 skip。
- `npm run check`：通过，无 formatter 修复。
- Mutation：2/2 generation guard 变异被捕获并恢复原 SHA-256。
- 80×24 tmux + local faux provider：思考、1 个工具运行、完成摘要、Token 88→192、单行宽度、Footer Session 累计和非交互命令均通过。
- AI 测试合同：TC-001 至 TC-008 全部通过；业务验收无偏差。

## Feature 4: Structured Execution Registry

### 新增

- 新增 closed-schema `byz_execution` managed tool：原子建立 1–64 个任务、显式 seal，并只在存在唯一 active task 时显示真实 `Step N/T`。
- 新增合法任务状态机、host generation/planId、bounded receipts、深冻结 plain snapshot 和订阅接口。
- 新增 declared、categorized observed 与 fully bound verified 证据分层；自然语言和普通命令成功不能冒充验证通过。
- 新增现有 Session custom entries 的 append-before-commit 持久化与同 Session replay，不创建项目或全局第二状态源。
- 新增并行/乱序工具绑定、生命周期 failure receipt 收口，以及 hostile replay 的有界失败关闭和显式新 generation 恢复。

### 变更

- Conversation compact/details/completion 只消费可靠冻结事实；无 sealed plan 时继续完整省略 Tasks、total、ordinal 和百分比。
- 80 列状态预算优先保留阶段、`Step 64/64`、耗时和 Token，不展示任务标题、命令、路径或 raw tool 字段。
- Feature 5 Safe Pause/Resume 和 Feature 6 Delivery Console 仅保留已审批规格；本批未实现其行为。

### 关键文件

- `packages/byz/src/execution/execution-registry.js` — reducer、原子 receipt、replay、evidence 与 frozen consumer。
- `packages/byz/src/execution/execution-extension.js` — managed tool、tool lifecycle 和 Session replay 组合。
- `packages/byz/src/adapters/pi/pi-execution-adapter.ts` — closed Pi capability projection。
- `packages/byz/src/conversation/conversation-extension.js` — 可靠步骤和完成 counts 的低噪声展示。
- `packages/byz/test/execution-registry.test.mjs`、`execution-extension.test.mjs`、`conversation.test.mjs` — 边界、真实 AgentSession 和 80 列回归。

### 架构决策

- Session append 是 transition 的线性化点；只有 append 成功后才 commit、删除 binding 和 publish。
- 未接受的 hostile sequence/generation 不推进后续恢复基线；新 generation 从最后 accepted receipt 继续。
- lifecycle closure 必须持久化 bounded failure receipt，append 失败时保留 binding 以便重试，且不得完成 task。
- Pause/Delivery 后续只能消费同一深冻结 snapshot，不能获得 reducer mutation API。

### 验证

- BYZ package：254 通过，0 失败，1 项平台 skip。
- Focused registry/managed tool/Conversation/architecture：78/78 通过。
- `npm run check` 与 `git diff --check`：通过。
- 真实 80×24 tmux：no-plan 完整省略步骤；faux managed 64-task 流恰有一行 `Step 64/64`，最大 80 Unicode 列。
- 持久命令凭证：13/13 command groups exit 0；fixture、脚本和 working diff 均有 SHA-256 绑定。
- AI 测试合同：TC-001 至 TC-008 全部通过；业务验收 AC-001 至 AC-015 无偏差。
