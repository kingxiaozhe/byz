# LESSONS

## 2026-08-30 — Conversation Shell v3 timing

- [已结构化] Assistant `message_update` 是流式高频事件；只允许首次进入 reply 阶段时重绘，实时时钟由唯一的 1 秒 interval 驱动。
- [已结构化] 人工确认等待必须覆盖自然语言 input 与 fallback confirm 的完整 `try/finally` 边界，异常或取消也要恢复或结束计时。
- [已结构化] Working message 在 80 列终端使用短阶段标签和分行累计值；最终摘要可以使用完整阶段标签。
- [已结构化] Footer Thinking 是真实状态的只读消费者：初始化读取 effective level，后续监听 `thinking_level_select` 并请求重绘，不自行修改 Thinking。
