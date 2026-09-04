# Safe Pause and Resume — 任务清单

## 任务版本

| 日期 | 版本 | 说明 |
| --- | --- | --- |
| 2026-09-02 | v1 | 初始任务；后续批次待批准 |
| 2026-09-02 | v2 | 纳入 P1；Feature 4 依赖更新为 T-009，并增加 Runtime Boundary T-023 前置门禁 |
| 2026-09-02 | v3 | Runtime Boundary 前置门禁更新为人工批准的替代任务 T-025 |
| 2026-09-02 | v4 | Runtime Boundary 前置门禁更新为人工批准的替代任务 T-026 |
| 2026-09-03 | v5 | 归档两轮整体实现审查；新增 T-006 接管并行批次、边界异常、compaction timing 与 closed receipt 缺口 |
| 2026-09-03 | v6 | 归档第二轮被阻塞的 T-006；新增 T-007 关闭 PausePort raw end payload 与 post-agent_end compaction timing |
| 2026-09-03 | v7 | 新增 T-008 修正真实 TUI paused 阶段的 pre-hook tool 假运行提示并完成最终 QA |
| 2026-09-03 | v8 | 归档第二轮证据复制被阻塞的 T-008；新增 T-009 生成完整隔离 QA image |

## 项目信息

- 项目名: pi-monorepo
- 架构类型: npm workspace monorepo
- specs 路径: `specs/byz-conversational-agent/5.safe-pause-resume/`
- 优先级: P1（本轮最高）
- 执行状态: `[APPROVED]` v5 替代任务已由用户批量授权；T-001 至 T-005 作为两轮整体审查历史冻结

## 任务列表

### 防护网与失败轨迹

- [ ] T-001: [DROPPED][CHANGED v4] 运行现有 AgentSession extension、Conversation timing/confirmation 和 BYZ package 基线；确认 Runtime Boundary T-026 已完成，再增加 pause 红灯，完整覆盖方案审查的八条失败轨迹：agent_end continuation、compaction provider path、typed cancel、admitted/start race、confirmation lease、边界 registry snapshot、receipt failure 和 running status ~1h
  - 模块: `packages/coding-agent/test/**`、`packages/byz/test/**`
  - 覆盖: AC-001 至 AC-014

### Product-neutral model request gate

- [ ] T-002: [DROPPED][CHANGED v2] 在 Pi runtime 增加 payload-free awaited `model_request_gate`，覆盖 Agent、retry、auto/manual compaction、branch/session summarization 及 retries；补 normal/no-handler compatibility、cancelled gate 和调用次数测试 ~1h
  - 模块: `packages/coding-agent/src/core/agent-session.ts`、model/compaction runtime、extension types/runner 与最近测试
  - 依赖: T-001
  - 覆盖: AC-002、AC-008、AC-013

### Pause controller 与 timing

- [ ] T-003: [DROPPED][CHANGED v2] 实现 generation-bound pause controller、同步 reducer linearization queue、await 前后 op sequence 校验、typed `resumed|cancelled` gate、admitted/in-flight 收口、Adapter allowlist `agent_settled` terminal、shared confirmation lease、actual-boundary registry snapshot 和 fixed-reason pause timing ~1h
  - 模块: `packages/byz/src/execution/pause-controller.js`、`packages/byz/src/conversation/turn-timing.js`、focused tests
  - 依赖: T-002、Feature 4 T-009、Open Source Runtime Boundaries T-026
  - 覆盖: AC-002 至 AC-011、AC-013

### Adapter、命令与 Conversation 集成

- [ ] T-004: [DROPPED][CHANGED v2] 扩展 PausePort/Pi Adapter，注册 `/pause`、`/pause resume|status|cancel`，连接 tool/model gates、best-effort receipts、modal `/pause` 拒绝循环和 compact/completion 状态；保证 Pi `/resume` 不变 ~1h
  - 模块: BYZ application port、Pi Adapter、CLI、Conversation/pause extension 与测试
  - 依赖: T-003
  - 覆盖: AC-001、AC-004 至 AC-014

### 最终验证

- [ ] T-005: [DROPPED][CHANGED v2] 两轮整体实现审查已冻结，由 T-006 统一接管，不创建 attempt 3
  - 模块: Feature 5 QA/TUI/范围审计
  - 依赖: T-004
  - 覆盖: AC-001 至 AC-014

- [ ] T-006: [DROPPED][NEW][P1] 已达到两轮审查上限；由 T-007 接管，不创建 attempt 3
  - 覆盖: AC-001 至 AC-014
- [x] T-007: [NEW][P1] 接管 T-006 attempt 2：PausePort 对 tool end 仅投影 ID/name/error，不含 args/result/path/command；Conversation 在配置 pause controller 时延迟 agent_end completion 到 agent_settled，使 agent_end 后的 compaction pause 仍有 timing/UI；增加 129-call production batch、post-agent_end request、snapshot closure 和 privacy 回归 ~30min
  - 依赖: T-006 审查证据、Feature 4 T-009、Runtime Boundary T-024；独立 review 链
  - 覆盖: AC-001 至 AC-014
- [ ] T-008: [DROPPED][NEW][P1] 两轮审查因隔离副本缺少继承文件而阻塞；产品行为已通过，T-009 接管证据门禁，不创建 attempt 3
  - 依赖: T-007
  - 覆盖: AC-012、AC-014
- [x] T-009: [NEW][P1] 在完整复制全部 inherited source/test/review/spec、链接只读依赖并预构建的隔离 worktree 中重跑 command-stamped focused/BYZ/check；绑定 requested/paused/resumed/abort/noninteractive 证据，完成最终可复现审查 ~30min
  - 依赖: T-007、T-008 两轮证据；仅证据重建，不修改产品行为
  - 覆盖: AC-001 至 AC-014

## 依赖关系

- Feature 5 整体依赖 Feature 4 T-009 已完成并合并，以及 Open Source Runtime Boundaries T-024 P1 QA 完成。
- T-001 至 T-005 的两轮整体实现审查及 T-006 两轮替代审查冻结；T-007 在批量授权下接管最终门禁。

## 风险点

- Pi 当前 `context` hook 不覆盖直接 compaction/summarization Provider 调用；T-002 是必要 runtime contract，不是可选复杂度。
- `agent_end` 不是 settled；retry、compaction 和 queue continuation 可能继续。
- Promise cleanup 若正常返回会误授权被暂停动作；必须使用 typed outcome。
- `/pause` 在 confirmation modal 中不会自动走 extension command dispatch，需 presenter 显式处理并维持原确认。
- 本 Feature 已完成一次方案审查并采纳 8 条发现；禁止规格期再开第二轮方案审查。
