# Project State Core — 任务清单

## 任务版本

| 日期 | 版本 | 说明 |
| --- | --- | --- |
| 2026-08-30 | v1 | 初始任务 |

## 项目信息

- 项目名: pi-monorepo
- 架构类型: BYZ Domain/Application/SQLite adapters
- specs 路径: `specs/byz-open-source-project-partner-architecture/2.project-state-core/`

## 任务列表

### 防护网基线

- [ ] T-001: 在修改前运行并记录仓库非 E2E 回归 `./test.sh` 和 BYZ package tests，确认 Feature 1 已批准边界可用 ~1h
  AC: AC-007, AC-009

### Project Domain 与存储

- [ ] T-002: 实现 Project/Goal/Scope/Task/Decision/Operation/Artifact/Evidence/Checkpoint 领域类型、合法状态 reducer、事件 schema 和 InMemoryProjectRepository ~1h
  AC: AC-006, AC-007, AC-008
- [ ] T-003: 实现每项目 SQLite schema、完整 batch copy/validate/atomic-promote migration、旧 schema 只读 adapter 和私有文件权限 ~1h
  AC: AC-009, AC-010
- [ ] T-004: 实现 `.byz/project.json`、canonical workspace、Git common-dir repository anchor、本机 workspace index 和 opaque VerifiedProjectAccess ~1h
  AC: AC-001, AC-002, AC-003, AC-004, AC-005
- [ ] T-005: 实现 SqliteProjectRepository 的事件+投影原子 append、expectedVersion/CAS、短 writer lease，并接入 VerifiedProjectAccess ~1h
  依赖: T-002, T-003, T-004
  AC: AC-006, AC-007, AC-008, AC-009
- [ ] T-006: 实现 register/link/move/conflict/getProjectStatus 用例，使合法 worktree 自动分配 workspaceId、其他复制目录要求显式关联，并返回安全 status projection ~1h
  依赖: T-004, T-005
  AC: AC-003, AC-004, AC-005, AC-013
- [ ] T-007: 实现 archive 与 allowlisted JSON/Markdown export，用例只通过 Application/VerifiedProjectAccess 访问状态 ~30min
  依赖: T-005
  AC: AC-011
- [ ] T-008: 独立实现 versioned deleting tombstone、exclusive fenced lease、拒绝新 open/append、分阶段清理与 resumable DeleteReport ~1h
  依赖: T-005
  AC: AC-012
- [ ] T-009: 通过 Command Registry 增加 `byz project status|link|archive|export|delete`，所有输出来自 Application use cases ~30min
  依赖: T-006, T-007, T-008
  AC: AC-004, AC-011, AC-012, AC-013

### 集成与测试

- [ ] T-010: 建立 InMemory/SQLite repository conformance，覆盖访问拒绝、事件回放、transaction 故障、并发冲突、migration batch、删除竞态和 symlink/trust 边界 ~1h
  依赖: T-005, T-006, T-007, T-008
  AC: AC-002, AC-005, AC-006, AC-007, AC-008, AC-009, AC-010, AC-012
- [ ] T-011: 运行 `npm run check`、目标测试、`./test.sh` 和独立 HOME 下的 project CLI smoke，核对无私有状态进入仓库或诊断 ~1h
  依赖: T-009, T-010
  AC: AC-001, AC-011, AC-013

## 依赖关系

```text
T-001 → T-002,T-003,T-004
T-002,T-003,T-004 → T-005
T-005 → T-006,T-007,T-008
T-006,T-007,T-008 → T-009,T-010
T-009,T-010 → T-011
```

## 风险点

- `projectId` 是公开标识，任何私有状态操作都必须经过 VerifiedProjectAccess。
- migration、delete 和并发 append 都需要明确 fence；不能依赖平台文件删除语义。
- 删除状态机与 archive/export 分开交付和审查。
- 不将 Project 状态塞入现有 Session backend，避免跨 Session 生命周期耦合。
