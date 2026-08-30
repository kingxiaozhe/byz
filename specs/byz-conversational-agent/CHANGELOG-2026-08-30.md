# 变更日志 — 2026-08-30

> base-commit: 67c664d6d

## Feature 1: Conversation Shell v3

### 新增

- Interactive turn 顶部 working message 每秒展示当前阶段和阶段耗时。
- Footer 展示当前实际生效的 Thinking 等级，并随 Thinking 事件热更新。
- Turn 完成后展示各阶段耗时、累计执行耗时、等待确认和总历时。
- 自然语言确认与 fallback confirmation 的等待时间独立累计，不计入 Agent 执行阶段。

### 关键文件

- `packages/byz/src/conversation/turn-timing.js` — 单调 turn 计时状态机、阶段累计和时长格式化。
- `packages/byz/src/conversation/conversation-extension.js` — 生命周期、阶段映射、1 Hz 展示、完成汇总和 Footer Thinking 状态。
- `packages/byz/test/conversation.test.mjs` — fake clock、等待分离、流式限频和 shutdown 回归。

### 架构决策

- 使用固定阶段 ID 和本地化标签，耗时摘要不消费 Prompt、路径、命令或工具参数。
- 流式 token 只触发首次 reply 阶段切换，后续时间展示由唯一的 1 秒 interval 驱动。
- 计时只存在于当前 turn，不写入 session、诊断日志或模型上下文。

## Feature 2: Routing Preferences

本轮无变更。
