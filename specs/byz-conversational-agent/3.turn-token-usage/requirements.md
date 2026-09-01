# Turn Token Usage — 需求规格

## 概述

在 BYZ 现有当前阶段耗时展示中加入当前回合的已观测 Token usage，让用户在不中断任务的情况下理解本轮模型资源消耗。

## 项目信息

- 项目名: pi-monorepo
- 架构类型: npm workspace monorepo；BYZ CLI/TUI 产品层
- 交付形态: 本地终端 CLI

## 需求版本

| 日期 | 版本 | 说明 |
| --- | --- | --- |
| 2026-09-01 | v1 | 新增当前回合 Token usage 进度与完成摘要 |
| 2026-09-01 | v2 | 明确 mandatory all-zero placeholder 保持不可用 |

## 用户故事

- 作为正在等待长任务的用户，我想在阶段耗时旁看到当前回合已经确认的输入与输出 Token，以便判断本轮资源消耗。
- 作为关注成本透明度的用户，我想区分输入、输出、缓存读取和缓存写入，以便避免把不同口径误认为一个总 Token。
- 作为使用不同 Provider 的用户，我想让缺失 usage 保持明确不可用，以便界面不把估算值或未知值当成事实。

## 功能需求

1. [F-001] Agent 执行期间，working message 必须在现有耗时信息旁显示当前回合已观测的输入与输出 Token。
2. [F-002] 当前回合 usage 必须在 `agent_start` 清零，并随着本回合模型响应的 usage 到达而分段更新；不得把进入本回合前的 Session 历史 usage 计入。
3. [F-003] 正常完成摘要必须显示当前回合已观测的输入、输出、缓存读取和缓存写入；Footer 继续保持 Session 累计口径，不改为当前回合口径。
4. [F-004] 只能展示 Pi/Provider 返回且可证明已观测的 usage。尚未观测到 usage、Provider 不提供 usage、字段非法，或 mandatory usage 对象只有全零且没有独立 presence 证据时，必须显示不可用或省略对应字段，不得估算、推断或将未知值显示为零；同一 payload 中只要至少一个字段为正，其他显式合法零字段保留为 observed `0`。`[v2 修改: 明确 all-zero placeholder 与 mixed observed zero 的边界]`
5. [F-005] Token 展示不得增加模型调用、网络请求、持久化、诊断事件或刷新定时器；不得暴露 Prompt、模型响应、Provider payload、凭据或文件路径。

## 非功能需求

- 性能: 复用现有每秒 working-message 刷新和模型消息事件；不得每秒扫描完整 Session 历史，也不得按 streaming delta 高频重绘。
- 准确性: 只接受有限、非负的数值字段；mandatory 全零对象在没有独立 presence 证据时不建立 observed presence，mixed payload 中的显式零字段仍保留；多次 streaming 更新不得重复累计同一模型响应；聚合必须保留已建立的逐字段 presence，安全整数相加溢出的字段失败关闭。
- 兼容性: 不改变现有阶段耗时、确认等待、Footer Session 累计、Thinking 热更新和非交互命令行为。
- 安全: Adapter 只投影 `input`、`output`、`cacheRead`、`cacheWrite` 数值，不向 BYZ Core 暴露原始消息或 Provider payload。
- 依赖: 零新增运行时依赖。

## 验收标准

- [x] [AC-001] Agent 刚开始且尚未观测到 usage 时，working message 显示 `Token —`，不会显示历史 Session usage 或伪造的零。→ 已通过自动测试与 80 列 TUI 验证
- [x] [AC-002] 第一次模型响应返回 usage 后，working message 显示该回合累计的 `↑输入` 与 `↓输出`；后续工具执行期间继续保留已确认值。→ 已通过自动测试与 80 列 TUI 验证
- [x] [AC-003] 同一模型响应的多次 streaming update 只替换当前响应快照，不重复累加；本回合发生多次模型响应时，各响应 usage 恰好累计一次。→ 已通过自动测试验证
- [x] [AC-004] `agent_end` 后的唯一完成通知同时包含阶段耗时及当前回合输入、输出、缓存读取、缓存写入；mandatory standalone all-zero 且无独立 presence 证据时显示不可用，至少一个正值已证明 payload observed 时，其他显式合法零字段显示为 `0`。`[v2 修改: 人工选择 observed-only 的失败关闭口径]`
- [x] [AC-005] Session Footer 仍显示 Session 累计 usage；当前回合展示不会改变 Footer 数值、Thinking 信息或左右区域优先级。→ 已通过自动测试与 80 列 TUI 验证
- [x] [AC-006] 缺失 usage 或只返回 mandatory all-zero placeholder 的 Provider 显示 `Token —`；缺失单个可选字段时只省略该字段，不补估算值。→ 已通过自动测试验证 `[v2 修改: 明确 all-zero placeholder]`
- [x] [AC-007] NaN、Infinity、负数、字符串、单值超出安全整数范围以及多个合法值相加后的安全整数溢出均失败关闭；受影响字段不进入进度区、完成摘要或累计值。→ 已通过自动测试验证
- [x] [AC-008] Pi 在正常完成、取消和异常路径发出的真实 `agent_end` 必须清理 usage 状态与现有计时器；`session_shutdown` 作为会话销毁兜底，新回合从不可用状态重新开始。→ 已通过真实 faux AgentSession 与 mutation 验证
- [x] [AC-009] 实现不新增网络、模型调用、存储、诊断写入或 timer；消息事件只触发必要的状态更新，现有单一 1 秒 interval 保持不变。→ 已通过运行时 spy、架构门禁与全量回归验证
- [x] [AC-010] 80 列真实 TUI 中阶段时间和当前回合 Token 均可读；`--version`、workflow 管理等非交互输出保持不变。→ 已通过 80×24 tmux 与非交互命令验证

## 依赖

- `packages/byz/src/conversation/conversation-extension.js` 现有阶段耗时与 Footer usage 格式化逻辑。
- `packages/byz/src/adapters/pi/pi-runtime-adapter.ts` Conversation capability facade。
- Pi extension 的 `message_update`、`message_end` 与 `agent_end` 生命周期 usage。

## 开放问题

- 无。已确认采用“进度区显示当前回合输入/输出，完成摘要补充缓存口径，Footer 保留 Session 累计”的方案。
