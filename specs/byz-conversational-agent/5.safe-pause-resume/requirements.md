# Safe Pause and Resume — 需求规格

## 概述

让用户通过 `/pause` 请求在下一个安全运行时边界暂停当前执行，并通过 `/pause resume` 在同一 live Session 中继续；保持 Pi 现有 `/resume` 历史 Session 入口不变。

## 项目信息

- 项目名: pi-monorepo
- 架构类型: npm workspace monorepo；BYZ CLI/TUI 产品层 + Pi agent loop
- 交付形态: 本地终端 CLI
- 本批执行: 否；依赖 Feature 4 稳定后另行批准

## 需求版本

| 日期 | 版本 | 说明 |
| --- | --- | --- |
| 2026-09-02 | v1 | 初始需求；确认采用 `/pause resume` 避免 `/resume` 冲突 |

## 范围

**做：** pause requested/paused/resuming 状态、provider/tool 安全边界 gate、并行工具收口、独立暂停计时、同一进程 Session 续跑、abort/shutdown 清理和结构化任务快照联动。

**不做：** 中断正在执行的工具；冻结外部进程；跨进程恢复被中断的 provider 请求；替代 confirmation；修改 Pi `/resume`；把 pause 宣传为权限沙箱。

## 用户故事

- 作为长任务用户，我想请求暂停而不直接取消，以便检查进度后继续。
- 作为正在执行工具的用户，我想让当前工具安全结束后再暂停，以免留下半执行状态。
- 作为恢复执行的用户，我想看到暂停发生在哪个结构化任务和等待了多久，以便确认继续的是同一上下文。
- 作为现有 Pi 用户，我想继续使用 `/resume` 打开历史 Session，以免新功能破坏已有入口。

## 功能需求

1. [F-001] `/pause` 仅在 Agent 正在运行时创建 session-scoped pause request；idle 时必须说明没有可暂停执行，不得 arm 下一回合。
2. [F-002] pause request 不得中止正在 streaming 的 Provider 调用或已放行工具；必须在下一个 payload-free model request gate 或尚未放行的 tool call gate 阻塞后续执行。model gate 必须覆盖普通 Agent、自动重试、compaction、summarization 及其 retry 的全部 Provider 路径。
3. [F-003] 并行工具批次已被 tool-call hook 放行或已经开始时，必须等待全部 admitted/in-flight 工具结束后进入 paused；暂停期间不得放行新工具或新 Provider request。
4. [F-004] `/pause resume` 必须只恢复当前 live Session 的 paused gate；`/pause status` 只读展示 `running|requested|paused|resuming|idle|stale`、当前 registry taskId（存在时）和等待时间。
5. [F-005] Pi 现有 `/resume` 历史 Session selector 行为保持不变；不得注册同名覆盖命令。
6. [F-006] pause waiting 必须从 BYZ 模型活跃时间和工具时间中排除，并在完成摘要中独立显示为“暂停”；confirmation waiting 继续独立统计，二者不得互相恢复或覆盖。
7. [F-007] `/pause resume`、abort、agent settled、session reload/shutdown 和 command failure 必须以 generation-bound typed gate 收口；`agent_end` 后仍可能自动重试、compaction 或处理 queued continuation，因此不得提前丢弃有效 pause request。只有显式 resumed outcome 能继续被 gate 阻塞的 action，其他 outcome 必须取消/阻止。
8. [F-008] 真正进入 paused 边界时必须原子冻结当时的完整 bounded registry snapshot；resume 后继续同一 plan，pause 本身不得改变 task 状态或伪造 evidence。
9. [F-009] Session transcript 可记录 closed pause receipt 用于审计；进程重启或 reload 后若没有 live gate，历史 paused 状态必须规范化为 `stale`，提示重新发起任务，不能声称原调用可继续。
10. [F-010] confirmation 正在等待时 `/pause` 不得建立第二重 gate；Conversation 与 Pause 必须共享 generation-bound confirmation lease。modal 输入 `/pause` 时要显示不可用并继续同一 confirmation，不得把它当确认答案或 fallback。
11. [F-011] 多次 `/pause` 与 `/pause resume` 必须幂等；未 paused 时 resume 不启动 Agent、不创建新 turn、不改变 registry。
12. [F-012] compact 状态在真正 paused 后显示暂停和等待时间；requested 阶段仍显示当前真实工具/模型状态，并可按需提示“等待安全暂停”。

## 非功能需求

- 性能: 不新增 polling、heartbeat 或额外 interval；复用生命周期 hook、registry snapshot 和现有 working-message interval。
- 安全: pause 不授予权限、不撤销已授权外部动作、不声称冻结外部进程；状态不记录 Prompt、命令、参数、路径或 tool result。
- 兼容性: `/resume`、abort/Escape、steer/followUp、confirmation、compaction、Token 和 Footer 保持现有语义。
- 可靠性: 所有 gate 必须有 abort/shutdown 释放路径；不得因 promise 永久未 resolve 造成 Session 无法退出。
- 依赖: Feature 4 registry；零新增运行时依赖。

## 验收标准

- [ ] [AC-001] Agent idle 时 `/pause` 返回“没有正在执行的任务”，下一回合正常启动且不会自动暂停。
- [ ] [AC-002] Provider streaming 时请求 pause，不中断当前响应；普通下一轮、自动 retry、compaction 或 summarization 到达统一 model request gate 后均先进入 paused，期间没有新 Provider request。
- [ ] [AC-003] 工具 A 已通过 tool_call 但尚未发出 execution_start、工具 B 已运行时请求 pause，A/B 均正常结束且没有第三个工具被放行，admitted 与 in-flight 集合清空后才显示 paused。
- [ ] [AC-004] paused 后 `/pause resume` 恰好释放当前 gate 一次并继续同一 plan/task；重复 resume 为安全 no-op。
- [ ] [AC-005] `/pause status` 准确区分 requested 与 paused；有 registry active task 时显示安全 ID/count，没有时省略。
- [ ] [AC-006] `/resume` 仍打开 Pi 历史 Session selector，不触发 execution resume。
- [ ] [AC-007] 10 秒 model、5 秒 tool、8 秒 pause、4 秒 confirmation 的轨迹分别归入正确计时，BYZ 模型活跃时间不含后三者。
- [ ] [AC-008] pause requested 跨过带 will-retry/compaction/queued continuation 的 agent_end 仍保持；agent_settled、abort、reload、shutdown 以 cancelled outcome 释放 gate，旧 continuation 不能启动 action 或污染下一 turn。
- [ ] [AC-009] 真正进入 paused 时冻结的是全部 admitted tool 收口后的 registry task/evidence snapshot；同一 Session 进程重启后历史 paused receipt 显示 stale，不声称可以继续不存在的 Provider/tool 调用。
- [ ] [AC-010] confirmation waiting 中 modal 输入 `/pause` 不建立嵌套 gate、不触发 fallback confirm，并继续原 confirmation；完成 confirmation 后 timing 和状态正常恢复。
- [ ] [AC-011] pause/resume 不改变 registry task 状态、completed count 或 evidence count。
- [ ] [AC-012] 默认紧凑输出不包含命令、参数、路径、Prompt、响应正文或 tool result；details 也只显示 bounded pause receipt。
- [ ] [AC-013] 没有新增 timer、网络、项目存储或 diagnostics payload；Session custom entry 为唯一可选审计落点。
- [ ] [AC-014] faux provider、并行工具和 80×24 TUI 验证 pause requested、paused、resume、abort 与非交互隔离全部通过。

## 依赖

- Feature 4 `structured-execution-registry` 的 live snapshot 和 Session receipt。
- Pi extension command 在 streaming 期间立即执行的能力。
- Pi `context`/`tool_call` 等可 await 的安全边界、AbortSignal 与 session lifecycle。
- Turn timing 需扩展为 confirmation/pause 两种等待原因。

## 开放问题

- 无。已确认保留 Pi `/resume`，执行恢复使用 `/pause resume`。
