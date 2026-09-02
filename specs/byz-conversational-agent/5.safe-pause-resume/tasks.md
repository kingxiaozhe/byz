# Safe Pause and Resume — 任务清单

## 任务版本

| 日期 | 版本 | 说明 |
| --- | --- | --- |
| 2026-09-02 | v1 | 初始任务；后续批次待批准 |

## 项目信息

- 项目名: pi-monorepo
- 架构类型: npm workspace monorepo
- specs 路径: `specs/byz-conversational-agent/5.safe-pause-resume/`
- 执行状态: `[DEFERRED]` 本批不得由 `cm-ai` 执行；Feature 4 稳定后重新确认

## 任务列表

### 防护网与失败轨迹

- [ ] T-001: [DEFERRED][NEW] 运行现有 AgentSession extension、Conversation timing/confirmation 和 BYZ package 基线；先增加 pause 红灯，完整覆盖方案审查的八条失败轨迹：agent_end continuation、compaction provider path、typed cancel、admitted/start race、confirmation lease、边界 registry snapshot、receipt failure 和 running status ~1h
  - 模块: `packages/coding-agent/test/**`、`packages/byz/test/**`
  - 覆盖: AC-001 至 AC-014

### Product-neutral model request gate

- [ ] T-002: [DEFERRED][NEW] 在 Pi runtime 增加 payload-free awaited `model_request_gate`，覆盖 Agent、retry、auto/manual compaction、branch/session summarization 及 retries；补 normal/no-handler compatibility、cancelled gate 和调用次数测试 ~1h
  - 模块: `packages/coding-agent/src/core/agent-session.ts`、model/compaction runtime、extension types/runner 与最近测试
  - 依赖: T-001
  - 覆盖: AC-002、AC-008、AC-013

### Pause controller 与 timing

- [ ] T-003: [DEFERRED][NEW] 实现 generation-bound pause controller、同步 reducer linearization queue、await 前后 op sequence 校验、typed `resumed|cancelled` gate、admitted/in-flight 收口、Adapter allowlist `agent_settled` terminal、shared confirmation lease、actual-boundary registry snapshot 和 fixed-reason pause timing ~1h
  - 模块: `packages/byz/src/execution/pause-controller.js`、`packages/byz/src/conversation/turn-timing.js`、focused tests
  - 依赖: T-002、Feature 4 T-005
  - 覆盖: AC-002 至 AC-011、AC-013

### Adapter、命令与 Conversation 集成

- [ ] T-004: [DEFERRED][NEW] 扩展 PausePort/Pi Adapter，注册 `/pause`、`/pause resume|status|cancel`，连接 tool/model gates、best-effort receipts、modal `/pause` 拒绝循环和 compact/completion 状态；保证 Pi `/resume` 不变 ~1h
  - 模块: BYZ application port、Pi Adapter、CLI、Conversation/pause extension 与测试
  - 依赖: T-003
  - 覆盖: AC-001、AC-004 至 AC-014

### 最终验证

- [ ] T-005: [DEFERRED][NEW] 运行 focused Pi/BYZ tests、BYZ package 和 `npm run check`；用 faux provider、parallel delayed tools、compaction/retry fixture 与 80×24 tmux 验证 requested/paused/resume/abort/stale、计时和非交互隔离，完成 Feature QA ~1h
  - 模块: Feature 5 QA/TUI/范围审计
  - 依赖: T-004
  - 覆盖: AC-001 至 AC-014

## 依赖关系

- Feature 5 整体依赖 Feature 4 T-005 完成并获得独立 review/QA。
- T-002 依赖 T-001；T-003 依赖 T-002；T-004 依赖 T-003；T-005 依赖 T-004。

## 风险点

- Pi 当前 `context` hook 不覆盖直接 compaction/summarization Provider 调用；T-002 是必要 runtime contract，不是可选复杂度。
- `agent_end` 不是 settled；retry、compaction 和 queue continuation 可能继续。
- Promise cleanup 若正常返回会误授权被暂停动作；必须使用 typed outcome。
- `/pause` 在 confirmation modal 中不会自动走 extension command dispatch，需 presenter 显式处理并维持原确认。
- 本 Feature 已完成一次方案审查并采纳 8 条发现；禁止规格期再开第二轮方案审查。
