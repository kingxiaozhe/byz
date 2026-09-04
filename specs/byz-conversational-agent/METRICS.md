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
| T-001 | 4.structured-execution-registry | 2 | 3：replay、启动时工具绑定与 provenance 红灯缺口 | BLOCKED，由 T-006 替代 | 1：批准替代任务 T-006 |
| T-006 | 4.structured-execution-registry | 2 | 5：非法任务字段、英文状态、未知身份、toolCallId 与 details 脱敏 | BLOCKED，由 T-007 替代 | 1：批准替代任务 T-007 |
| T-007 | 4.structured-execution-registry | 2 | 0（主执行者自审拦截 5 项） | — | 0 |
| T-002 | 4.structured-execution-registry | 2 | 3：工具 receipt 原子性、恶意 replay 边界与最大 sequence 恢复阻断 | BLOCKED，由 T-008 替代 | 1：批准替代任务 T-008 |
| T-008 | 4.structured-execution-registry | 1 | 0（主执行者额外覆盖恶意 generation） | 合并至 Feature QA | 0 |
| T-003 | 4.structured-execution-registry | 2 | 1：补齐取消、异常、压缩、重载与关闭时的 in-flight 收口 | 合并至 Feature QA | 0 |
| T-004 | 4.structured-execution-registry | 2 | 1：补齐八十列极限状态行预算 | 合并至 Feature QA | 0 |
| T-005 | 4.structured-execution-registry | 2 | 5：补齐真实终端、生命周期收口、共享消费者及精确命令凭证 | BLOCKED，由 T-009 替代 | 1：批准替代任务 T-009 |
| T-009 | 4.structured-execution-registry | 1 | 0 | PASS（8/8、真实 80×24 双场景、13/13 命令组） | 0 |
| T-009 | 5.safe-pause-resume | 精简前完整链 | 多轮拦截后由最终替代任务收口 | PASS（Agent 24/24、coding-agent 33/33、BYZ 316/1 skip、80×24） | 0（批量授权内） |
| T-007 | 6.delivery-console | 1 次最终独立审查 | 5：repository、App check、分类证据、end event、隔离/TUI | PASS（BYZ 338/1 skip、仓库回归、bare origin/fake gh、80×24） | 1：批准精简收尾 |
