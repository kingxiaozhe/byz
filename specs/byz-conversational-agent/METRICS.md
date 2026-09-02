# METRICS

| 任务 | Feature | 审查轮次 | 独立审查拦截 | QA | 人工介入 |
| --- | --- | --- | --- | --- | --- |
| T-013 | 1.conversation-shell | 1 | 1：流式事件高频重绘 | PASS | 0 |
| T-014 | 1.conversation-shell | 1 | 0 | PASS | 0 |
| T-015 | 1.conversation-shell | 1 | 0 | PASS（80 列 faux provider） | 0 |
| T-016 | 1.conversation-shell | 1 | 0 | PASS（40/80 列热更新） | 0 |
| T-001 | 3.turn-token-usage | 2 | 1：补齐工具阶段保留断言 | — | 0 |
| T-002 | 3.turn-token-usage | 2 | 2：缺失 usage 零值与不可达事件前提 | 合并至 Feature QA | 0 |
| T-003 | 3.turn-token-usage | 2 | 2：真实取消清理与副作用证据 | PASS（80 列、packed、全量回归） | 2：批准恢复卡替代任务与 all-zero 口径 |
| T-004 | 3.turn-token-usage | 2 | 4：补齐短任务、双语、安全边界与跨回合清理证据 | —（delivery-diff） | 0 |
| T-005 | 3.turn-token-usage | 2 | 3：跨回合 timeout/interval/confirmation 与并行错误顺序 | 未计入（BLOCKED；delivery-diff） | 1：批准新增替代任务 T-007 |
| T-007 | 3.turn-token-usage | 1 | 0（忽略 2 条误报） | PASS（Feature QA 8/8；delivery-diff） | 0 |
| T-006 | 3.turn-token-usage | 2 | 2：补齐命令链与持久 TUI 证据 | PASS（8/8、80 列、2/2 mutations；delivery-diff） | 0 |
