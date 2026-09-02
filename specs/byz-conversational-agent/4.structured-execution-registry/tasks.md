# Structured Execution Registry — 任务清单

## 任务版本

| 日期 | 版本 | 说明 |
| --- | --- | --- |
| 2026-09-02 | v1 | 初始任务；本批批准候选 |

## 项目信息

- 项目名: pi-monorepo
- 架构类型: npm workspace monorepo
- specs 路径: `specs/byz-conversational-agent/4.structured-execution-registry/`
- 执行状态: 首次 `cm-ai` 仅执行本 Feature

## 任务列表

### 防护网与红灯

- [ ] T-001: [DROPPED] [NEW] 运行并记录现有 Conversation、architecture 与 BYZ package 基线；先增加 registry 红灯，覆盖 plan seal、合法/非法迁移、duplicate/stale generation、64-task bounds、并行 tool receipt、provenance、Session replay/fail-closed、零 registry 兼容和 compact 安全边界，不修改产品行为 ~45min
  - 替代: 第二轮独立审查仍有 3 项测试缺口，由用户批准的 T-006 接管现有测试字节；不得创建 T-001 attempt 3
  - 模块: `packages/byz/test/**`、feature prestate/review evidence
  - 覆盖: AC-001 至 AC-015

- [ ] T-006: [DROPPED] [NEW] 接管 T-001 attempt 2 的测试字节，补齐未知 schema/非法 replay、in-flight 工具启动时 task 绑定和 generic-success/failed-check provenance 红灯；复核完整防护网且不修改产品行为 ~30min
  - 替代: 第二轮独立审查仍有 3 项测试缺口，由用户批准的 T-007 接管现有测试字节；不得创建 T-006 attempt 3
  - 模块: `packages/byz/test/**`、T-001/T-006 review evidence
  - 覆盖: AC-001 至 AC-015

- [x] T-007: [NEW] 接管 T-006 attempt 2 的测试字节，补齐 unknown plan/task replay、恶意或越界 toolCallId、details 模式中英文 registry 脱敏红灯，并复核 closed-schema 边界；不修改产品行为 ~30min
  - 模块: `packages/byz/test/**`、T-006/T-007 review evidence
  - 覆盖: AC-001 至 AC-015

### Registry reducer 与 Session receipt

- [ ] T-002: [NEW] 新增纯 `execution-registry` service 和 focused tests，实现 host generation/planId、原子 plan_open、explicit seal、task reducer、bounded receipts、deep-frozen snapshot、closed error codes、propose→Session append→commit 原子性、entry replay 与损坏 generation 失败关闭 ~1h
  - 模块: `packages/byz/src/execution/**`、`packages/byz/test/execution-registry.test.mjs`
  - 依赖: T-007
  - 覆盖: AC-002 至 AC-004、AC-008 至 AC-010、AC-013、AC-015

### Managed tool 与 runtime evidence

- [ ] T-003: [NEW] 扩展 BYZ application port 与 Pi Adapter，注册 closed `byz_execution` managed tool，投影专用 Session custom entries 和 bounded tool lifecycle；实现 active-task 绑定、并行/乱序 receipt、ephemeral command classifier（仅 categorized observed）及 formal runtime/trusted workflow verified receipt 边界 ~1h
  - 模块: `packages/byz/src/application/ports/runtime.ts`、`packages/byz/src/adapters/pi/pi-runtime-adapter.ts`、registry extension/tests；如现有 Pi extension API 不足，仅补最小 product-neutral runtime API
  - 依赖: T-002
  - 覆盖: AC-005 至 AC-009、AC-012、AC-013

### Conversation 集成

- [ ] T-004: [NEW] 在 BYZ CLI 组合 registry 单例，并让 Conversation 只消费 frozen snapshot：可靠时追加 `步骤 N/T` 和完成/evidence counts，不可靠时省略；保持 Token、工具、timing、details、Footer、中英文和默认信息边界 ~45min
  - 模块: `packages/byz/src/cli.js`、`packages/byz/src/conversation/conversation-extension.js`、对应测试
  - 依赖: T-003
  - 覆盖: AC-001、AC-002、AC-010 至 AC-015

### 最终验证

- [ ] T-005: [NEW] 运行 focused registry/Conversation/architecture、`npm --prefix packages/byz test` 与 `npm run check`；用真实 AgentSession/faux provider 和 80×24 tmux 验证 64/64 单行、无 plan 回归、取消/异常/reload、非交互隔离及 raw-field absence，并完成 Feature QA ~45min
  - 模块: Feature 4 QA/TUI/范围审计
  - 依赖: T-004
  - 覆盖: AC-001 至 AC-015

## 依赖关系

- T-001 已停止，由 T-006 替代；T-006 已停止，由 T-007 替代。
- T-002 依赖 T-007。
- T-003 依赖 T-002。
- T-004 依赖 T-003。
- T-005 依赖 T-004。

## 风险点

- 独立方案 reviewer 在时限内未返回最终 findings，已按单轮上限升级至人审；执行前必须重点核对 Session replay、provenance 与 managed tool 边界。
- 模型调用 structured tool 只证明 declared transition，不自动证明业务完成；verified 必须绑定运行时 receipt。
- Session custom entries 是持久输入，重放必须把损坏 generation 失败关闭，不能“尽量恢复”为完成。
- Adapter 不得为方便暴露完整 Pi messages、tool args/result 或 append arbitrary custom type。
