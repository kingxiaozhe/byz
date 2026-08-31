# Project State Core — 需求规格

## 概述

建立独立于 Pi Session 的长期 Project 权威状态、事件存储和本机私有 Repository，为后续记忆、检查点与恢复提供稳定基础。

## 项目信息

- 项目名: pi-monorepo
- 架构类型: Pi 派生的 npm workspace monorepo
- 上下文范围: full（contract_or_data）

## 需求版本

| 日期 | 版本 | 说明 |
| --- | --- | --- |
| 2026-08-30 | v1 | 初始需求 |

## 用户故事

- 作为 BYZ 用户，我想让一个项目跨多个 Session 保持同一目标、范围、任务和决策，以便长期继续工作。
- 作为多 worktree 用户，我想让不同工作区既共享项目身份又保留独立现场，以便并行开发不互相覆盖。
- 作为高隐私用户，我想让项目状态只保存在本机私有目录，并能删除和导出。
- 作为维护者，我想通过 Repository contract 和 migration 管理状态，以便崩溃与并发不会损坏项目事实。

## 功能需求

1. [F-001] 受信任项目必须使用 `.byz/project.json` 保存公开 `projectId`、schema 和非敏感可移植配置。
2. [F-002] BYZ 必须在用户私有目录维护 project/workspace 索引，并为不同 canonical workspace 分配独立 `workspaceId`。
3. [F-003] Project Core 必须定义 Project、Goal、Scope、Task、Decision、Operation、Artifact、Evidence 和 Checkpoint 的稳定领域契约。
4. [F-004] 所有领域变化必须追加为带版本的事件，并在同一 SQLite transaction 中更新事件和物化投影。
5. [F-005] Project Repository 必须提供内存与 SQLite 两种实现，并通过同一 conformance contract；所有私有状态读写必须要求由 trust/identity adapter 生成的不可伪造 VerifiedProjectAccess。
6. [F-006] Project 必须使用递增版本执行乐观并发控制，冲突时不得静默覆盖。
7. [F-007] SQLite schema 必须使用可重复、可审计 migration；完整 pending batch 必须原子成功或保留原数据库，失败时以版本化只读 adapter 打开并允许导出。
8. [F-008] 未受信任项目不得仅凭复制的 `projectId` 读取另一项目的本机私有状态。
9. [F-009] 用户必须能够查看项目状态、重新关联移动后的工作区、归档、导出和删除本机状态。

## 非功能需求

- 安全: 私有目录使用 `0700`，状态文件使用 `0600`；canonical path 和 symlink 必须验证。
- 可靠性: transaction 只覆盖短状态提交，不覆盖模型回合或工具执行。
- 一致性: 事件序列和物化投影在提交后必须对应同一 project version。
- 兼容性: Project schema 提供自动 migration；失败不得破坏旧数据库。
- 性能: 普通状态读取不得扫描整个项目文件树或全部 Session。

## 验收标准

- [ ] [AC-001] 新受信任项目可生成不含绝对路径、用户名和记忆正文的 `.byz/project.json`。
- [ ] [AC-002] 未受信任目录引用已存在 `projectId` 时，BYZ 不返回该项目目标、任务、决策或记忆。
- [ ] [AC-003] 同一项目的两个 Git worktree 通过 canonical Git common-dir 等 repository anchor 证明关系后，获得相同 `projectId` 和不同 `workspaceId`。
- [ ] [AC-004] 项目目录移动后，用户确认重新关联即可继续使用原状态，不复制新的项目事实。
- [ ] [AC-005] 无法证明 repository anchor 关系的目录即使包含同一 `projectId` 也进入冲突状态，必须显式重新关联且不静默合并。
- [ ] [AC-006] 每次领域提交同时追加事件并更新投影；任一步失败时两者均不提交。
- [ ] [AC-007] 两个 Repository 实现对创建、打开、事件追加、查询、冲突、归档和删除返回一致结果。
- [ ] [AC-008] 两个 Session 基于同一 project version 更新时，后提交者收到版本冲突并重新加载，不覆盖先提交决策。
- [ ] [AC-009] 崩溃发生在 transaction 提交前后时，重启后只观察到完整旧版本或完整新版本。
- [ ] [AC-010] 多个 pending migrations 任一步失败时，原数据库保持迁移前版本；系统通过对应旧 schema 的只读 adapter 进入 `storage-unavailable` 并允许安全导出。
- [ ] [AC-011] 项目导出不包含凭证、诊断原始事件和其他项目数据。
- [ ] [AC-012] 删除先提交带版本 tombstone 并取得 exclusive fenced lease，拒绝新 open/append 后再删除数据库、索引和导出；部分失败可续跑且不得报告全部成功。
- [ ] [AC-013] `byz project status` 能显示项目身份、workspace、状态版本、活跃任务数和待决项数量，不展示敏感正文。

## 依赖

- Node.js `node:sqlite` 与现有 SQLite backend 的 migration/conformance工程模式。
- 现有 project trust 和 canonical path 能力。
- Feature 1 提供的 BYZ Application/Ports/Adapter 边界。

## 开放问题

- 无阻塞问题。首期项目导出为用户主动触发的本地 JSON/Markdown，不提供加密导出。
