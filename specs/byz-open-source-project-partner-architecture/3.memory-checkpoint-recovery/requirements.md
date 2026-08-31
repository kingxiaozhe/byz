# Memory Checkpoint Recovery — 需求规格

## 概述

在 Project Core 上实现分级记忆、无代码副本检查点、Operation 中断识别、工作区漂移核对和低噪声跨会话恢复。

## 项目信息

- 项目名: pi-monorepo
- 架构类型: Pi 派生的 npm workspace monorepo
- 上下文范围: full（security_sensitive）

## 需求版本

| 日期 | 版本 | 说明 |
| --- | --- | --- |
| 2026-08-30 | v1 | 初始需求 |

## 用户故事

- 作为用户，我想让 BYZ 自动记录客观任务证据，但只有我确认的信息才成为长期记忆。
- 作为用户，我想查看、接受、拒绝和忘记记忆，并知道每条记忆来自哪里。
- 作为用户，我想在崩溃或中断后看到真实现场并安全继续，而不是重复工作或虚假完成。
- 作为并行开发用户，我想让 BYZ 发现外部工作区变化并重新核对，而不是覆盖其他会话改动。

## 功能需求

1. [F-001] 记忆必须区分 ObservedEvidence、ProjectFact、CandidateMemory 和 UserMemory，模型推测只能进入候选状态。
2. [F-002] 用户必须能够列出候选/正式记忆、查看来源、接受、拒绝、替代和彻底忘记正文；global memory 使用独立私有 Repository，不复制到各项目数据库。
3. [F-003] 每轮持久任务必须使用带 lease/liveness 的 Operation 记录开始、完成和中断；只有稳定 settled outcome 可关闭 Operation，任务完成必须有对应验证与 committed checkpoint。
4. [F-004] 检查点必须显式记录 Project/Task 版本、相对路径与哈希、结构化 Git branch/HEAD/status digest、验证结果、decision IDs 和 typed pending items，默认不得复制代码或完整输出。
5. [F-005] BYZ 启动时必须以纯只读投影评估 `none`、`resumable`、`needs-reconciliation`、`needs-decision`、`blocked` 或 `storage-unavailable`；只有 Operation lease 过期并通过 CAS 后才能另行标记中断。
6. [F-006] 只有存在中断、待决或阻塞事项时主动显示恢复卡；普通项目静默加载。
7. [F-007] 用户说“继续”时只能恢复当前突出项；工作区无漂移可继续，存在漂移时必须先重新核对。
8. [F-008] 恢复不得自动执行 Git 破坏性命令、覆盖/删除文件、安装、部署、发布或批量恢复。
9. [F-009] Memory 和 Recovery 必须提供自然语言控制与等价 CLI 命令。

## 非功能需求

- 隐私: 不保存密钥、Cookie、Token、文件正文、完整 diff、命令 stdout/stderr 或 Provider payload。
- 删除: “忘记”必须删除 BYZ 当前管理的数据库、投影和导出中的正文；不承诺删除外部备份或文件系统历史。
- 可靠性: 恢复评估只读；外部动作结果不确定时不自动重试。
- 交互: 恢复卡默认只突出一个推荐事项，技术详情按需展开。
- 并发: 多个 Operation 独立记录，通过 Project version 处理冲突。

## 验收标准

- [ ] [AC-001] 工具、文件和验证结果只能自动进入 ObservedEvidence，不能自动成为 ProjectFact 或 UserMemory。
- [ ] [AC-002] 模型提出的记忆以 CandidateMemory 保存，未接受时不进入长期上下文。
- [ ] [AC-003] 用户确认的目标、范围和决策可成为 ProjectFact，并保留 source event、session 和确认时间。
- [ ] [AC-004] 用户忘记记忆后，当前 BYZ 数据库、物化投影和 BYZ 管理导出中检索不到原文，事件只保留无正文 tombstone。
- [ ] [AC-005] 检查点显式包含 project/task version、相对路径与哈希、branch、HEAD、status digest、decision IDs、typed pending items 和验证结论，但不包含文件正文、完整 diff、环境变量和完整命令输出。
- [ ] [AC-006] 修改后验证前崩溃，只有原 Operation lease/liveness 证明失效且 CAS 成功后才标记 OperationInterrupted；仍存活的并发 Operation 不被启动扫描误判。
- [ ] [AC-007] 无漂移中断在用户说“继续”后从缺失验证开始，不重复已确认决策。
- [ ] [AC-008] Git HEAD、branch、已记录文件哈希或 workspace 任一变化都会进入 `needs-reconciliation`。
- [ ] [AC-009] “按当前工作区重新核对”只执行读取和验证，不还原旧文件或接受全部变化。
- [ ] [AC-010] 存在 PendingDecision 时恢复优先展示原影响、推荐、替代项和拒绝结果，并等待用户决定。
- [ ] [AC-011] 同时存在多个恢复项时优先级为存储不可用、待决、漂移、可恢复、普通阻塞；“继续”只作用于当前项。
- [ ] [AC-012] 无恢复事项时启动界面不增加项目摘要噪声。
- [ ] [AC-013] `/memory` 与 `byz memory` 的查看、接受、拒绝、忘记语义一致；删除和外部副作用仍需确认。
- [ ] [AC-014] 连续两次恢复中断不会创建重复完成事件或丢失最初 Operation 关联；Pi settled lifecycle 通过稳定 runId 区分 completed、aborted、failed 和 retrying。

## 依赖

- Feature 2 的 Project Repository、事件、Operation、Artifact、Evidence 和乐观并发。
- 独立 `~/.byz/profile/state.sqlite` global-memory Repository 及其 migration/concurrency contract。
- Feature 1 的 Pi Adapter、Conversation Presenter 和 Command Registry。
- Git 只读状态与 workspace 边界能力。

## 开放问题

- 无阻塞问题。首期不保存完整文件快照，不提供自动代码回滚。
