# Turn Token Usage — 任务清单

## 任务版本

| 日期 | 版本 | 说明 |
| --- | --- | --- |
| 2026-09-01 | v1 | 当前回合 Token usage 展示 |
| 2026-09-01 | v2 | 明确 all-zero placeholder 口径；现有实现已满足，无返工任务 |

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

## 依赖关系

- T-002 依赖 T-001。
- T-003 依赖 T-002。

## 风险点

- 不同 Provider 返回 usage 的时点不同；只能承诺 observed、按响应分段更新，不能承诺逐 Token 实时。
- `message_update` 与 `message_end` 可能携带同一 usage；必须 snapshot replace 后恰好提交一次，不能直接对事件求和。
- Adapter 若投影完整 message 会破坏 BYZ Core 的 Pi API 隔离；只允许闭合 usage 数值与 role。
- 80 列 working message 增加一行后必须保持阶段时间与 Token 可读，不能挤压待决提示或 Footer 高优先级区域。
- 当前工作区已有 Trusted CM Recovery Card 的未提交修改；执行时必须限定写集，禁止混入其文件或审查证据。
- v2 只澄清 mandatory all-zero placeholder 的失败关闭语义；T-002 现有正值 presence gate 已实现该行为，不新增或重开已完成任务。
