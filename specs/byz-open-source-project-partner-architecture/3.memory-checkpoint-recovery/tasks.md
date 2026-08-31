# Memory Checkpoint Recovery — 任务清单

## 任务版本

| 日期 | 版本 | 说明 |
| --- | --- | --- |
| 2026-08-30 | v1 | 初始任务 |

## 项目信息

- 项目名: pi-monorepo
- 架构类型: BYZ Memory/Checkpoint/Recovery services
- specs 路径: `specs/byz-open-source-project-partner-architecture/3.memory-checkpoint-recovery/`

## 任务列表

### 防护网基线

- [ ] T-001: 在修改前运行并记录 `./test.sh`、BYZ package tests 和 Project Repository conformance，确认现有 Session resume/Conversation 行为 ~1h
  AC: AC-006, AC-012

### Memory

- [ ] T-002: 实现 ObservedEvidence/ProjectFact/CandidateMemory/UserMemory 领域合同、project memory projection 和独立 global-memory Repository/migration/concurrency ~1h
  AC: AC-001, AC-002, AC-003
- [ ] T-003: 实现 propose/accept/reject/supersede/forget/list 用例及 `/memory`、`byz memory` 等价命令；forget 清理正文、索引和 managed exports 并写无正文 tombstone ~1h
  依赖: T-002
  AC: AC-002, AC-003, AC-004, AC-013

### Operation、Checkpoint 与恢复

- [ ] T-004: 在 Pi Core 增加 product-neutral settled lifecycle result 与 stable runId，覆盖 completed/aborted/failed/retrying，不包含 BYZ 产品语义 ~1h
  模块: `packages/coding-agent` extension event contract；BYZ Pi Adapter
  AC: AC-006, AC-014
- [ ] T-005: 实现带 owner identity、renewable lease、liveness 和 CAS 的 Operation lifecycle；启动评估不得误中断仍存活的并发 Operation ~1h
  依赖: T-004
  AC: AC-006, AC-007, AC-014
- [ ] T-006: 实现显式 checkpoint schema/writer，保存 project/task version、Git baseline、artifact hash、verification、decision IDs 和 typed pending items ~1h
  AC: AC-005, AC-006
- [ ] T-007: 实现 Application task-completion policy：只有 settled completion、所需 verification 和 committed checkpoint 同时存在时才能写 TaskCompleted；重复提交幂等 ~30min
  依赖: T-005, T-006
  AC: AC-005, AC-006, AC-014
- [ ] T-008: 实现 trusted workspace 只读 scanner 和 drift classifier，只读取 checkpoint 相关路径与 Git metadata 并阻止 symlink 越界 ~1h
  依赖: T-006
  AC: AC-008, AC-009
- [ ] T-009: 实现纯只读 RecoveryAssessment、过期 lease 中断 transition、resume/reconcile/decision/pause 用例和多项优先级 ~1h
  依赖: T-005, T-006, T-007, T-008
  AC: AC-006, AC-007, AC-008, AC-009, AC-010, AC-011, AC-014
- [ ] T-010: 在 Conversation Presenter 和 Command Registry 中实现低噪声恢复卡、详情展开、当前项绑定的“继续”和 `byz project resume|pause` ~1h
  依赖: T-009
  AC: AC-007, AC-010, AC-011, AC-012

### 集成与测试

- [ ] T-011: 增加 Memory 生命周期、global scope、来源追踪、候选隔离、并发忘记和当前 BYZ 管理存储删除测试 ~1h
  依赖: T-003
  AC: AC-001, AC-002, AC-003, AC-004, AC-013
- [ ] T-012: 增加 completion-policy 拒绝/幂等、Operation lease、Pi settled outcome、checkpoint 隐私、Git drift、多 Session、连续中断和 transaction crash 恢复测试 ~1h
  依赖: T-007, T-009
  AC: AC-005, AC-006, AC-007, AC-008, AC-009, AC-010, AC-011, AC-014
- [ ] T-013: 运行 `npm run check`、目标测试、`./test.sh` 与 faux-provider 端到端恢复 smoke；同时核对 `/memory` 与 `byz memory` parity、正常启动无摘要、异常启动只突出一项 ~1h
  依赖: T-003, T-010, T-011, T-012
  AC: AC-012, AC-013

## 依赖关系

```text
T-001 → T-002,T-004,T-006
T-002 → T-003 → T-011
T-004 → T-005
T-005,T-006 → T-007
T-006 → T-008
T-005,T-006,T-007,T-008 → T-009 → T-010
T-007,T-009 → T-012
T-003,T-010,T-011,T-012 → T-013
```

## 风险点

- 启动恢复必须是纯只读评估；中断写入需要 lease/liveness + CAS。
- TaskCompleted 由独立 Application policy 控制，不能把 Agent settled 等同于任务完成。
- global memory 必须独立存储，不能扫描或复制所有项目数据库。
- “彻底忘记”只承诺当前 BYZ 管理存储，不夸大为文件系统取证级擦除。
