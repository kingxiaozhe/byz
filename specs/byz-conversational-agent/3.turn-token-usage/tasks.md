# Turn Token Usage — 任务清单

## 任务版本

| 日期 | 版本 | 说明 |
| --- | --- | --- |
| 2026-09-01 | v1 | 当前回合 Token usage 展示 |
| 2026-09-01 | v2 | 明确 all-zero placeholder 口径；现有实现已满足，无返工任务 |
| 2026-09-02 | v3 | 优化紧凑执行状态、工具计数与模型活跃时间摘要 |
| 2026-09-02 | v4 | 停止两轮审查阻塞的 T-005，经人工批准新增独立替代任务 T-007 |

## 项目信息

- 项目名: pi-monorepo
- 架构类型: npm workspace monorepo
- specs 路径: `specs/byz-conversational-agent/3.turn-token-usage/`

## 任务列表

### 防护网与基准

- [x] T-001: [NEW] 记录 Conversation facade、working message、完成摘要与 Footer usage 的现状基线；增加先失败回归，固定 unknown、单响应多 update、多响应和 Session/turn 口径边界 ~20min

### 当前回合 Token usage

- [x] T-002: [NEW] 在 Pi Adapter 增加 closed-schema usage 投影，在 Conversation extension 实现逐字段 presence、checked addition、turn-scoped 去重累计、进度/完成展示及生命周期清理；同一任务内补齐非法字段、累计溢出、缓存、agent_end override、80 列和 capability architecture 测试 ~1h

### 回归与交付验证

- [x] T-003: [NEW] 运行 focused Conversation/architecture 测试、`npm --prefix packages/byz test`、`npm run check`；通过 faux provider 的取消/错误 `agent_end` 和现有 packed fixture 验证清理、真实 80 列 TUI 阶段时间与 Token 展示及非交互隔离 ~40min

### v3 执行状态优化 `[NEW v3]`

- [x] T-004: [NEW] 在修改存量 Conversation 模块前运行 `packages/byz/test/conversation.test.mjs` 与 BYZ package suite并记录基线；先补齐全部 v3 logic 红灯，覆盖 2 秒延迟、单行 headline、工具仍运行时的 assistant update、并行/乱序/重复/无 ID 配对、模型活跃时间、完成统计、生命周期清理、中英文与 compact 信息边界，不修改产品行为 ~40min
  - 模块: `packages/byz/test/conversation.test.mjs`、feature 基线凭证
  - 覆盖: AC-001, AC-002, AC-004, AC-008, AC-009, AC-011 至 AC-016

- [ ] T-005: [BLOCKED v4; no attempt 3] 两轮独立审查后停止：attempt 2 已实现统一 selector、2 秒单行状态、observed Token headline、并行工具统计、模型活跃时间和完成摘要，并修复 timeout generation 与并行错误顺序；但 interval 回调和异步 confirmation continuation 尚未绑定 turn generation，可能在新回合重绘或错误恢复等待计时。当前实现和 review 只作为 T-007 输入，不构成批准凭证 ~1h

- [x] T-007: [NEW v4] 作为 T-005 的独立替代任务接管其 attempt 2 字节；先新增“旧回合 interval callback 在新回合执行”和“旧 confirmation finally 在新回合等待期间恢复”红灯轨迹，再以统一 turn generation guard 约束 timeout、interval 与 confirmation continuation，保持已通过的并行错误、Token、详情、Footer、中英文和零新增 capability/依赖行为，重新运行完整 task review ~30min
  - 依赖: T-004
  - 模块: `packages/byz/src/conversation/conversation-extension.js`、`packages/byz/test/conversation.test.mjs`
  - 覆盖: AC-008, AC-009, AC-013, AC-016

- [x] T-006: [NEW] 复跑 focused Conversation/architecture、`npm --prefix packages/byz test` 与 `npm run check`；用 faux provider 和 80×24 tmux 验证短 turn 无闪烁、并行工具乱序、异常/取消清理、中英文单行、完成摘要、非交互隔离及无 Tasks/raw fields ~40min
  - 依赖: T-007
  - 模块: v3 feature QA、TUI smoke 与最终范围审计
  - 覆盖: AC-001 至 AC-016

## 依赖关系

- T-002 依赖 T-001。
- T-003 依赖 T-002。
- T-004 是 v3 防护网入口；T-005 已在两轮审查后阻塞，禁止 attempt 3。
- T-007 作为独立替代任务依赖 T-004，并接管 T-005 attempt 2 当前字节；T-006 依赖 T-007。

## 风险点

- 不同 Provider 返回 usage 的时点不同；只能承诺 observed、按响应分段更新，不能承诺逐 Token 实时。
- `message_update` 与 `message_end` 可能携带同一 usage；必须 snapshot replace 后恰好提交一次，不能直接对事件求和。
- Adapter 若投影完整 message 会破坏 BYZ Core 的 Pi API 隔离；只允许闭合 usage 数值与 role。
- 80 列 working message 增加一行后必须保持阶段时间与 Token 可读，不能挤压待决提示或 Footer 高优先级区域。
- v2 只澄清 mandatory all-zero placeholder 的失败关闭语义；T-002 现有正值 presence gate 已实现该行为，不新增或重开已完成任务。
- Pi 可能并行或乱序结束工具；v3 必须按稳定 toolCallId 配对，不能用 toolName 或简单增减计数。
- `message_update` 只证明 assistant 输出开始；“BYZ 思考时间”是客户端模型活跃 stage 聚合，不得宣传为 hidden reasoning 时间。
- 默认紧凑状态从现有多行卡改为单行，容易碰坏 details、语言、Footer 与 80 列布局；T-004/T-006 必须覆盖这些存量波及面。
- 当前没有 runtime task registry；任何实现阶段临时增加 Tasks 计数都属于范围扩大，必须回到规格审批。
- T-005 已达到两轮审查上限；T-007 必须作为新任务重新绑定当前实现与 review，不得创建或伪造 T-005 attempt 3。
