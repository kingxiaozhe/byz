---
at: 2026-09-02T07:50:00-07:00
feature: 4.structured-execution-registry
role: product-manager
verdict: passed
business_deviations: 0
---

# Structured Execution Registry — 业务验收走查

## 用户流程闭环

1. **无结构化计划**：用户继续看到原有低噪声状态、Token 和 Footer，不出现 Tasks、步骤或虚假百分比。
2. **可靠计划执行**：managed tool 建立并 seal 1–64 个唯一任务；唯一 active task 才显示真实 `Step N/T`，80 列下仍为单行。
3. **执行证据**：声明、运行时观察和正式验证分层展示；普通命令成功不冒充测试通过。
4. **异常与恢复**：非法 transition、损坏 Session receipt 和 hostile sequence 失败关闭；显式新 generation 可恢复。生命周期结束只持久化收口 in-flight receipt，不伪造任务完成。
5. **后续消费者**：Conversation 以及模拟的 Pause/Delivery 角色读取同一份深冻结事实，不可旁路修改。

## AC 对照

| AC | 结论 | 用户视角证据 |
| --- | --- | --- |
| AC-001 | 通过 | 真实 no-plan TUI 无 Step、Tasks、total 或百分比 |
| AC-002 | 通过 | sealed plan 的 ordinal/counts 由状态机和 Conversation 测试一致展示 |
| AC-003 | 通过 | 越界、重复、seal 后追加和双 active 均不产生伪造位置 |
| AC-004 | 通过 | 合法迁移、幂等和 stale/非法拒绝具有确定结果 |
| AC-005 | 通过 | 并行工具按开始时 task 与 toolCallId 配对一次 |
| AC-006 | 通过 | 默认界面和 Session receipt 不含命令、参数、路径、result 或自由错误 |
| AC-007 | 通过 | declared、categorized observed 与 trusted verified 不混淆 |
| AC-008 | 通过 | Session append 成功才发布；同一 Session 可重放同一事实 |
| AC-009 | 通过 | 损坏 generation 显示安全 unavailable，显式新 plan 后恢复 |
| AC-010 | 通过 | 结束、取消、异常、压缩、重载和关闭不伪造任务完成 |
| AC-011 | 通过 | 无 registry 时既有延迟、Token、Footer、中英文和非交互行为保持 |
| AC-012 | 通过 | compact/details/completion 不展示恶意 label 或 raw fields |
| AC-013 | 通过 | 只使用现有 Session custom entries，无第二套项目或全局状态 |
| AC-014 | 通过 | 真实 80×24 TUI 恰有一行 `Step 64/64`，最大 80 Unicode 列 |
| AC-015 | 通过 | 三类消费者共享深冻结 plain snapshot，外部修改无效 |

## 文案与边界

- 紧凑状态只增加可证明的步骤位置，无法证明时完整省略。
- unavailable 使用固定安全原因，不向用户展示原始异常或字段。
- Feature 5 暂停恢复和 Feature 6 交付控制台未在本批启用，仅验证它们可消费同一只读事实源。

业务偏差：无。无需人工补充验收。
