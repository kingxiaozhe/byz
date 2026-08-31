# Project State Core — 技术设计

## 设计版本

| 日期 | 版本 | 说明 |
| --- | --- | --- |
| 2026-08-30 | v1 | 初始设计 |

## 项目架构

- 架构类型: BYZ Domain/Application/Ports + Node SQLite adapter。
- 涉及层: Project domain、Repository、filesystem identity、project trust、CLI/status。
- 设计基准: 无 UI 视觉基准；命令输出以结构化状态合同验收。

## 设计目标

Project 是长期事实边界，Session 是对话边界。Project state 不存入 Pi Session custom entry，也不复用 session backend 表；只复用其 SQLite migration、writer lease和 conformance 思路。

## 功能模块设计

### 模块 1：Project Identity

项目内 `.byz/project.json`：

```ts
interface ProjectIdentityFile {
	schemaVersion: 1;
	projectId: string;
	stateStorage: "user-private";
}
```

文件不包含绝对路径、用户名和私有状态。读取 projectId 不等于授权：只有现有 project trust 通过且 canonical workspace 已在本机索引绑定后，才能打开私有 state。

本机 `index.sqlite` 保存 `project_id`、`workspace_id`、canonical root 指纹、project-level repository anchor、关联状态和最近打开时间。Git 项目优先使用 canonical Git common-dir identity 作为 anchor：同一 anchor 的新 worktree 可分配独立 workspaceId；无法证明 anchor 关系的目录必须显式重新关联。目录移动由用户确认后更新绑定；复制 projectId 到不相关目录产生冲突，不自动访问原项目。

### 模块 2：Domain 与事件

```ts
type ProjectEvent =
	| ProjectRegistered
	| GoalConfirmed
	| ScopeChanged
	| TaskCreated
	| TaskStatusChanged
	| DecisionRequested
	| DecisionConfirmed
	| OperationStarted
	| OperationFinished
	| ArtifactObserved
	| VerificationRecorded
	| CheckpointCommitted;
```

事件字段固定包含 eventId、projectId、aggregateId、type、schemaVersion、projectVersion、operationId/sessionId（适用时）、occurredAt 和 JSON payload。领域 reducer 是纯函数，拒绝非法状态转换与跳号版本。

### 模块 3：Repository Port

```ts
interface ProjectRepository {
	create(input: CreateProject): Promise<ProjectSnapshot>;
	open(access: VerifiedProjectAccess): Promise<ProjectSnapshot>;
	append(access: VerifiedProjectAccess, expectedVersion: number, events: readonly NewProjectEvent[]): Promise<ProjectSnapshot>;
	listTasks(access: VerifiedProjectAccess): Promise<ProjectTask[]>;
	archive(access: VerifiedProjectAccess, expectedVersion: number): Promise<ProjectSnapshot>;
	delete(access: VerifiedProjectAccess, expectedVersion: number): Promise<DeleteReport>;
	export(access: VerifiedProjectAccess, format: "json" | "markdown"): Promise<ExportArtifact>;
}
```

提供 InMemoryProjectRepository 和 SqliteProjectRepository。raw repository 保持 adapter 私有；Application 只能取得 trust/identity adapter 为当前 canonical workspace 签发的 opaque `VerifiedProjectAccess`。共享 conformance 套件验证正常、错误、访问拒绝和并发语义。

### 模块 4：SQLite schema 与 transaction

每个项目使用 `~/.byz/projects/<project-id>/state.sqlite`；`profile` 与 permissions 不进入本 feature。

核心表：

```text
schema_migrations
projects
project_events
project_tasks
project_decisions
project_operations
project_artifacts
project_evidence
project_checkpoints
```

一次 `append` transaction：读取当前 version → 比较 expectedVersion → 插入事件 → reducer 更新投影 → 更新 project version → commit。失败整体 rollback。

启用 foreign keys、busy timeout 和短 writer lease。进程不在模型调用、工具执行或用户确认期间持有 SQLite transaction。

### 模块 5：Migration 与只读降级

Migration 使用单调编号 SQL/TypeScript migration manifest。进程先取得 exclusive migration lease，将原数据库复制到同目录私有临时文件，在副本上执行完整 pending batch、integrity check 与 schema validation；全部成功后原子 promote，任一步失败均保留原数据库。每个仍受支持的旧 schema 提供最小只读 adapter，用于 status、doctor 和安全 export；禁止新事件。

Project schema 保证自动向前 migration。降级或不支持的未来 schema 不静默重建，也不允许半迁移数据库成为当前文件。

### 模块 6：Application use cases 与 CLI

```text
registerProject
linkWorkspace
getProjectStatus
archiveProject
deleteProject
exportProject
```

`byz project status` 通过 Application use case 返回安全摘要，不直接查询表。删除要求确认：先以 expectedVersion 写入 deleting tombstone 并取得 exclusive fenced project lease，阻止新 open/append，再删除数据库、index binding 和 managed exports。DeleteReport 持久化阶段进度以支持续跑；部分失败保持非零退出码和残留清单。

## 数据模型

```ts
interface ProjectSnapshot {
	id: string;
	status: "active" | "paused" | "archived";
	version: number;
	goal?: ConfirmedValue;
	scope?: ConfirmedValue;
	activeTaskIds: string[];
	pendingDecisionIds: string[];
	createdAt: string;
	updatedAt: string;
}

interface ProjectTask {
	id: string;
	projectId: string;
	title: string;
	status: "planned" | "active" | "waiting_for_user" | "blocked" | "completed" | "cancelled";
	acceptanceCriteria: string[];
}

interface WorkspaceBinding {
	projectId: string;
	workspaceId: string;
	rootFingerprint: string;
	state: "linked" | "moved" | "conflict";
}
```

## 安全考虑

- `projectId` 是公开标识，不是访问令牌。
- 私有状态打开必须同时满足 project trust、canonical root、repository anchor 和本机 workspace binding，并把结果封装为不可伪造 VerifiedProjectAccess。
- 路径解析不跟随越界 symlink；目录/file mode 使用 `0700/0600`。
- JSON event payload 使用封闭 schema，不允许凭证字段。
- 导出按 allowlist 生成，不复制数据库文件，不包含其他 project/profile/diagnostics 数据。

## 波及面

| 改动位置 | 直接调用方 | 可能受影响的老功能 | 回归保护 |
| --- | --- | --- | --- |
| 新 `packages/byz/src/domain/project/**`、`application/project/**` | 后续 memory/recovery/extension | 无现有调用方 | 纯 domain 单测 |
| 新 `packages/byz/src/adapters/sqlite/**` | Project use cases | BYZ 启动/退出、磁盘权限 | repository conformance + fault tests |
| 新 `packages/byz/src/adapters/filesystem/project-identity.ts` | bootstrap/project commands | `.byz` project config 与 trust | symlink/trust fixture tests |
| `packages/byz/src/bootstrap/**` | `byz` CLI | 启动路径 | package smoke |
| `packages/coding-agent/src/core/project-trust.ts`、`trust-manager.ts`（通过 Adapter 调用，必要时只加通用只读接口） | interactive trust | 现有项目资源 trust | coding-agent trust regression |

## 技术决策

| 决策 | 选项 | 理由 |
| --- | --- | --- |
| 权威存储 | 每项目 SQLite + 全局索引 | 原子提交、隔离删除、便于导出和 migration |
| Session 复用 | 不复用 session tables | Project 跨 Session，生命周期和隐私语义不同 |
| 并发 | optimistic version + short transaction | 不锁模型回合，冲突显式 |
| projectId | 项目内公开，私有索引授权 | 可移植但不把 ID 当秘密 |
| migration 失败 | 只读降级 | 避免静默丢失状态 |
| 加密导出 | 首期不做 | 已确认范围；本地显式导出足够 MVP |
