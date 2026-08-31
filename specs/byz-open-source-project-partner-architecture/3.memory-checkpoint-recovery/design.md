# Memory Checkpoint Recovery — 技术设计

## 设计版本

| 日期 | 版本 | 说明 |
| --- | --- | --- |
| 2026-08-30 | v1 | 初始设计 |

## 项目架构

- 架构类型: Project Core 上的 Memory、Checkpoint、Recovery application services。
- 涉及层: domain、SQLite projection、Pi lifecycle adapter、Git/filesystem scanner、TUI Presenter、CLI。
- 设计基准: 无视觉基准；恢复卡文案与控制选项按 requirements 验收。

## 功能模块设计

### 模块 1：分级记忆

```ts
type MemoryKind = "project-fact" | "user-memory";
type CandidateStatus = "pending" | "accepted" | "rejected" | "expired";

interface CandidateMemory {
	id: string;
	projectId?: string;
	proposal: string;
	reason: string;
	sourceEventId: string;
	status: CandidateStatus;
	createdAt: string;
}

interface MemoryEntry {
	id: string;
	scope: "project" | "global";
	kind: MemoryKind;
	contentRef: string;
	sourceEventId: string;
	status: "active" | "superseded";
	createdAt: string;
}
```

ObservedEvidence 只进入 evidence projection。用户确认的 Goal/Scope/Decision 由确定性 use case 生成 ProjectFact。模型仅能调用 `proposeMemory`，不能 accept/delete。

记忆正文单独存储在可删除表，事件只保存 memoryId、状态和来源引用。project memory 位于项目数据库；global memory 位于独立 `~/.byz/profile/state.sqlite` Repository，拥有独立 migration、version/concurrency 和删除合同，项目数据库只保留必要引用。正式上下文检索只返回 active 且 scope 匹配的正式记忆，并附来源；Candidate 不自动注入。

### 模块 2：Memory 删除

`forgetMemory` 要求用户确认，删除正文、候选副本、检索索引和 BYZ 管理导出，写入无正文 tombstone。SQLite adapter 启用 secure delete 策略并处理 WAL checkpoint；完成报告只承诺当前 BYZ 管理存储不可再检索，不承诺 OS 快照、备份或已复制外部文件。

### 模块 3：Operation 与检查点

Pi Adapter 在持久任务开始时创建带 stable runId、owner process identity 和 renewable lease 的 OperationStarted。Pi Core 提供产品无关 settled lifecycle result：`completed | aborted | failed | retrying`；只有 completed/明确终止结果可以通过 CAS 关闭对应 Operation，retrying 保持同一 run lineage。工具生命周期只生成安全 ObservedEvidence；语义完成由 Application 根据 task/AC/verification 决定。

```ts
interface Checkpoint {
	id: string;
	projectId: string;
	taskId?: string;
	operationId: string;
	projectVersion: number;
	taskVersion?: number;
	workspace: { workspaceId: string; branch?: string; head?: string; statusDigest: string };
	artifacts: ArtifactFingerprint[];
	verificationIds: string[];
	decisionIds: string[];
	pendingItems: Array<{ kind: "verification" | "decision" | "artifact" | "input"; ref: string }>;
	createdAt: string;
}
```

ArtifactFingerprint 只含 workspace-relative path、kind、hash 和 observedAt。Verification 只保存命令类别/测试标识、退出状态、时间和 evidence reference；默认不保存 stdout/stderr、环境和命令中的秘密参数。

### 模块 4：Workspace Scanner

只读 scanner 输入 canonical workspace 和上一个 checkpoint，输出：

- Git branch/HEAD；
- tracked/untracked/modified 摘要；
- 已记录 artifact 的存在性和 hash；
- workspaceId；
- drift categories。

scanner 不执行 checkout/reset/clean/stash，不读取越界 symlink，不扫描无关大文件。只有 checkpoint 相关路径和 Git metadata 进入比较。

### 模块 5：Recovery Assessment

```ts
type RecoveryState =
	| "none"
	| "resumable"
	| "needs-reconciliation"
	| "needs-decision"
	| "blocked"
	| "storage-unavailable";
```

优先级：storage unavailable → pending decision → workspace drift → interrupted operation → blocked task → none。

Assessment 是纯只读、可重复计算投影，启动评估不写 project event，也不改变 project version。若 Operation 未关闭，先核验 lease、owner liveness 和 stable runId；只有 lease 过期且 compare-and-swap 成功的独立 transition 才写一次 `OperationInterrupted`。仍存活的并发 Operation 只显示 active，不进入恢复。后续恢复通过 parentOperationId 连接，避免重复完成。

### 模块 6：恢复 use cases

- `assessRecovery`: 启动时纯只读评估，不持久化 RecoveryAssessed。
- `resumeCurrent`: 无漂移且用户明确“继续”时创建子 Operation，从缺失验证开始。
- `reconcileCurrentWorkspace`: 读取当前文件和重新验证，不还原旧内容。
- `resolvePendingDecision`: 复用原 impact/recommendation/alternatives/rejectOutcome。
- `pauseRecovery`: 保留任务、Operation 与 checkpoint。

多个恢复项只选择一个 highlighted item；“继续”绑定其 recoveryId，不能批量应用。

### 模块 7：Presenter 与命令

启动时 `none` 不显示项目摘要。其他状态渲染自然语言恢复卡，细节模式才显示 Git/hash/operation 等技术证据。

```text
/memory [list|candidates|accept|reject|forget]
/project [status|resume|pause]
byz memory ...
byz project resume
```

交互命令与 CLI 调用同一 Application use case。删除、外部动作和需求决策保持核心确认边界。

## 接口契约

```ts
interface MemoryService {
	propose(input: ProposeMemory): Promise<CandidateMemory>;
	accept(id: string, approval: UserApproval): Promise<MemoryEntry>;
	reject(id: string, approval: UserApproval): Promise<void>;
	forget(id: string, approval: UserApproval): Promise<DeleteReport>;
	list(query: MemoryQuery): Promise<MemoryView[]>;
}

interface GlobalMemoryRepository {
	append(expectedVersion: number, change: GlobalMemoryChange): Promise<GlobalMemorySnapshot>;
	list(query: GlobalMemoryQuery): Promise<MemoryView[]>;
	forget(id: string, expectedVersion: number): Promise<DeleteReport>;
}

interface RecoveryService {
	assess(projectId: string, workspaceId: string): Promise<RecoveryAssessment>;
	resume(recoveryId: string, approval: UserApproval): Promise<OperationView>;
	reconcile(recoveryId: string): Promise<RecoveryAssessment>;
}
```

## 安全考虑

- Memory content 不进入不可变事件和 diagnostics。
- scanner 路径必须在 trusted canonical workspace 内。
- 工具参数、输出和 Provider payload 不进入 checkpoint。
- 外部动作结果不确定时记录 unknown，不自动重放。
- 恢复不会调用破坏性 Git 命令或自动覆盖文件。

## 波及面

| 改动位置 | 直接调用方 | 可能受影响的老功能 | 回归保护 |
| --- | --- | --- | --- |
| 新 `domain/memory/**`、`application/memory/**` | memory commands/context builder | 模型上下文组成 | memory lifecycle/privacy tests |
| 新 `domain/checkpoint/**`、`application/recovery/**` | Pi Adapter、project commands | session resume、任务完成陈述 | crash/replay tests |
| 新 filesystem/Git scanner adapter | recovery | 工作区读取性能和 trust | symlink/drift fixtures |
| `adapters/pi` lifecycle binding | interactive/print sessions | agent/tool start/end | faux provider integration tests |
| Conversation Presenter | startup/progress/confirmation | 低噪声欢迎与恢复卡 | conversation regression + card snapshots |
| Project SQLite schema | memory/checkpoint tables | migration、删除 | migration and delete tests |

## 技术决策

| 决策 | 选项 | 理由 |
| --- | --- | --- |
| 记忆写入 | 分级 + 用户确认 | 防止模型推测成为事实 |
| 正文存储 | 可删除表，事件仅引用 | 同时满足来源审计和忘记 |
| 检查点 | metadata/hash/evidence | 避免代码副本和并行覆盖 |
| 恢复启动 | 异常时主动，正常静默 | 保持低噪声产品体验 |
| 漂移策略 | 当前工作区重新核对 | 用户文件始终是事实，不自动回滚 |
| Git 操作 | 全部只读检测 | 遵守并行会话和安全边界 |
