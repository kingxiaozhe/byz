# LESSONS

## 2026-08-30 — Conversation Shell v3 timing

- [已结构化] Assistant `message_update` 是流式高频事件；只允许首次进入 reply 阶段时重绘，实时时钟由唯一的 1 秒 interval 驱动。
- [已结构化] 人工确认等待必须覆盖自然语言 input 与 fallback confirm 的完整 `try/finally` 边界，异常或取消也要恢复或结束计时。
- [已结构化] Working message 在 80 列终端使用短阶段标签和分行累计值；最终摘要可以使用完整阶段标签。
- [已结构化] Footer Thinking 是真实状态的只读消费者：初始化读取 effective level，后续监听 `thinking_level_select` 并请求重绘，不自行修改 Thinking。

## 2026-09-01 — Turn Token Usage / observed usage 边界

- [已结构化] Pi Provider 会用全零对象初始化 mandatory usage；只有至少一个计数字段为正时，才能把同一消息中的零值解释为 observed zero，否则必须保持 unavailable。
- [已结构化] Agent loop 的 streaming partial 走 `message_update`，终态走 `message_end`；测试必须分别验证可达的 partial snapshot 和权威终态，不能伪造 terminal `message_update`。
- [已结构化] 聚合要保留逐字段 presence 并执行 checked safe-integer addition；累计溢出后该字段失败关闭，不能让后续值重新恢复。
- [已结构化] 取消/错误清理必须先观察非零 usage，再通过真实 `agent_end` 当场断言 turn usage、working message 与唯一 interval 已清空；下一回合初始化不能替代 cleanup 证据。
- [已结构化] Cleanup mutation 必须删除 `finishTurn()` 的清理调用，而不是删除下一回合初始化；只有前者能证明异常生命周期真正释放资源。
- [已结构化] Pi/Provider mandatory all-zero usage 在没有独立 presence 信号时按 unavailable 失败关闭；只有正值证明 payload observed 后，显式零 sibling 才能显示为 `0`。
- [已结构化] `.cm-specs-status` 保存规范化 AC/task checkbox 后的语义哈希；审批完整性必须用 `cm-spec-manifest.py --status-file` 验证，不能与 raw SHA-256 比较。

## 2026-09-02 — Turn Token Usage v3 / 跨回合异步隔离

- [已结构化] 清除 timer handle 不能单独证明已经排队的 callback 安全；timeout 与 interval callback 必须捕获 turn generation，并在读取共享当前回合状态前校验。
- [已结构化] confirmation presenter 的异步 `finally` 也属于 turn continuation；旧回合结束后不得恢复或重绘新回合的等待计时。
