# 变更日志 — 2026-09-02

> base-commit: f28fd093d306879a19e404bf9e5f1d3f1ec3aab1

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
