# BYZ 开源与长期项目伙伴架构——产品需求文档

> 成熟度：L2 成熟规格
> 类型：B CLI / 开发者工具
> 产品方向：开源完整 monorepo，核心架构受控，社区贡献集中在扩展能力层。

## 1. 问题陈述

BYZ 已具备 CLI、工作流、Fast、Prewalk、对话壳和本地诊断能力，但长期项目状态仍主要依赖 Session、Prompt 和扩展闭包。

继续直接添加记忆与恢复功能，将产生以下问题：

- Session 同时承担对话与项目状态，无法可靠跨会话恢复；
- BYZ 产品逻辑直接依赖 Pi 内部接口，增加上游升级冲突；
- 配置、状态和诊断采用不同存储方式；
- 社区扩展缺少稳定 API、权限声明和来源锁定；
- BYZ 与 Pi 的代码所有权和贡献边界不够清晰。

## 2. 已确认的产品决策

| 决策 | 结论 |
| --- | --- |
| 开源范围 | 完整 monorepo，保留 Pi 上游历史 |
| 协作模式 | BYZ Core 受控，欢迎社区扩展贡献 |
| 社区扩展范围 | Workflow、Skill、Provider、外部集成、导入导出器 |
| 项目存储 | 项目 ID 在项目内，敏感状态保存在用户目录 |
| 记忆写入 | 分级写入，模型推测不得自动成为正式记忆 |
| 检查点 | 状态、事件、文件哈希、Git 摘要和验证证据 |
| 启动恢复 | 仅有中断、待决或阻塞事项时主动提示 |
| 恢复策略 | 按工作区漂移和决策风险分级 |
| 扩展信任 | 声明式资源与受信任代码两级模型 |
| 权限确认 | 低风险安装确认，高风险首次使用再次确认 |
| 扩展来源 | 本地、npm 精确版本、Git 完整 commit |

## 3. 目标用户

| 用户 | 主要诉求 |
| --- | --- |
| BYZ 用户 | 跨会话恢复项目，控制记忆，理解下一步 |
| BYZ 核心维护者 | 稳定同步 Pi，保护项目状态语义 |
| 社区贡献者 | 不修改 Core 即可增加外部能力 |
| 高隐私用户 | 本地存储、来源透明、可以删除和导出 |
| 新贡献者 | 从干净 clone 重现构建、测试和发布产物 |

## 4. 目标架构

```text
BYZ CLI / TUI
      ↓
Presentation
      ↓
Application Use Cases
      ↓
Project Domain Core
      ↓
Ports
      ↑
Pi / SQLite / Filesystem / External Adapters
```

建议目录：

```text
packages/byz/src/
├── bootstrap/
├── domain/
│   ├── project/
│   ├── task/
│   ├── decision/
│   ├── memory/
│   └── checkpoint/
├── application/
├── ports/
├── adapters/
│   ├── pi/
│   ├── sqlite/
│   ├── filesystem/
│   └── external/
├── presentation/
│   └── tui/
└── features/
    ├── conversation/
    ├── diagnostics/
    ├── fast/
    ├── prewalk/
    └── workflow/
```

依赖规则：

- Domain 不依赖 Pi、Node 文件系统、SQLite、TUI 或模型 API。
- Application 只能依赖 Domain 和 Ports。
- Adapter 实现 Ports。
- Workflow 提供能力，但不拥有 Project 状态。
- Diagnostics 观察事件，不修改领域状态。
- Session 是对话记录，不是 Project 的权威状态源。

## 5. 用户故事与验收标准

### US-001：跨会话恢复项目

作为用户，我希望重新打开项目后继续上次工作。

- [ ] 无异常状态时静默加载项目。
- [ ] 存在中断、待决或阻塞事项时展示恢复摘要。
- [ ] 恢复摘要包含目标、已完成事项、未完成事项和推荐动作。
- [ ] 用户说“继续”只恢复当前突出任务。
- [ ] BYZ 不把“恢复成功”误报为“任务完成”。

### US-002：可控长期记忆

作为用户，我希望决定 BYZ 可以长期保存什么。

- [ ] 用户可以查看每条正式记忆及来源。
- [ ] 模型推测只能进入候选记忆。
- [ ] 用户可以接受、拒绝或彻底删除候选及正式记忆。
- [ ] 跨项目个人信息必须明确授权。
- [ ] 密钥、Token、Cookie 永不进入记忆。

### US-003：中断和崩溃恢复

作为用户，我希望 BYZ 异常退出后保留可靠现场。

- [ ] 未关闭 Operation 会被识别为中断。
- [ ] 恢复前重新扫描工作区。
- [ ] Git HEAD 或文件哈希变化时先展示漂移摘要。
- [ ] 检查点不复制文件正文。
- [ ] 恢复不得自动覆盖、删除或回滚用户文件。

### US-004：社区扩展

作为贡献者，我希望通过稳定 API 增加外部能力。

- [ ] 扩展不需要导入 Pi 内部类型。
- [ ] 扩展只能通过公开 BYZ API 访问 Project。
- [ ] Manifest 未声明的 BYZ Capability 调用失败。
- [ ] 扩展不能确认用户决策或接受长期记忆。
- [ ] npm、Git 和本地来源均可追溯。

### US-005：权限透明

作为用户，我希望知道扩展会访问什么。

- [ ] 安装时展示来源、版本、信任等级和权限。
- [ ] 外部写入、发布、凭证使用在首次调用时再次确认。
- [ ] 权限升级、版本变化或来源变化后旧授权失效。
- [ ] 代码扩展明确提示拥有当前系统用户权限。
- [ ] BYZ 不把 Capability 宣传为系统沙箱。

### US-006：可持续同步 Pi

作为维护者，我希望 Pi 升级影响被限制在适配层。

- [ ] Domain 和 Application 不导入 Pi runtime。
- [ ] Pi 专属事件由统一 Adapter 转为 BYZ 领域事件。
- [ ] Pi Core 中新增能力使用通用命名，不使用 BYZ 产品命名。
- [ ] 上游升级冲突主要限制在 Adapter、构建和必要通用 hook。

## 6. 功能需求

### FR-001：仓库所有权边界

仓库必须明确区分：

1. Pi 上游代码；
2. BYZ 对 Pi 的通用扩展；
3. BYZ 产品代码；
4. Bundled Workflow；
5. 生成和发布产物。

必须提供 `UPSTREAM.md`、第三方声明、BYZ 贡献指南和安全策略。

### FR-002：项目识别

项目目录保存：

```text
.byz/project.json
```

内容只包含 schema、`projectId` 和非敏感可移植配置，默认允许提交 Git。

同一项目的不同 Git worktree 使用独立 `workspaceId`。

### FR-003：本机私有存储

```text
~/.byz/
├── profile/state.sqlite
├── projects/<project-id>/state.sqlite
├── permissions.sqlite
└── index.sqlite
```

目录权限必须为当前用户私有。所有 schema 变更必须使用可审计 migration。

### FR-004：领域状态

Core 至少维护：

- Project；
- Goal 和 Scope；
- Task；
- Decision；
- Operation；
- Checkpoint；
- Artifact；
- Evidence；
- CandidateMemory；
- UserMemory。

Project 使用递增 `version` 实现乐观并发控制。

### FR-005：事件存储

领域变化使用追加事件表达：

```text
ProjectRegistered
GoalConfirmed
ScopeChanged
TaskStarted
TaskBlocked
DecisionRequested
DecisionConfirmed
ArtifactObserved
VerificationRecorded
MemoryProposed
MemoryAccepted
CheckpointCommitted
OperationInterrupted
TaskCompleted
```

正式状态由事件投影产生。用户记忆正文不得直接写入不可变事件。

### FR-006：检查点

检查点记录：

- Project 和 Task 版本；
- Operation；
- 文件相对路径和哈希；
- Git branch、HEAD 和工作区摘要；
- 验证类型与结果；
- 已确认决策；
- 未完成事项。

默认不得记录文件正文、完整 diff、命令输出、环境变量或凭证。

### FR-007：恢复评估

```ts
type RecoveryState =
	| "none"
	| "resumable"
	| "needs-reconciliation"
	| "needs-decision"
	| "blocked"
	| "storage-unavailable";
```

启动检测必须只读。出现漂移时以当前工作区为事实基础重新核对，不自动恢复旧文件。

### FR-008：记忆生命周期

```text
模型提出 → CandidateMemory
用户接受 → ProjectFact/UserMemory
事实变化 → Superseded
用户忘记 → 硬删除正文并保留无正文 tombstone
```

模型不能执行接受、确认和删除操作。

### FR-009：Pi 防腐层

建立稳定 Ports：

```text
RuntimePort
SessionPort
ResourcePort
ModelPort
ProjectRepository
ArtifactStore
Clock
```

将 Pi Core 中的 BYZ 专属能力泛化为 managed resource、capability token 和 product UI profile。

### FR-010：Conversation 拆分

`conversation-extension` 必须拆分为控制器、Presenter、进度投影、Footer、语言目录、偏好存储和 Pi 生命周期绑定。

偏好存储必须使用原子写入、schema 校验和私有权限。

### FR-011：扩展信任

扩展分为：

- `declarative`：无可执行入口；
- `trusted-code`：拥有当前系统用户权限。

声明式资源仍属于不可信指令输入，不能绕过项目工具和确认策略。

### FR-012：扩展 Capability

首期支持：

```text
project.summary:read
project.task:read
project.task:propose
project.artifact:read
project.artifact:write
project.evidence:read
project.evidence:write
project.event:subscribe
memory.candidate:propose
memory.project:read
memory.global:read
external.<service>:read
external.<service>:write
external.<service>:publish
credential.<service>:use
```

不得向扩展公开决策确认、记忆接受、项目删除、凭证明文和通用 Shell API。

### FR-013：来源与锁定

- npm 必须锁定精确版本和 integrity；
- Git 必须锁定完整 commit；
- 本地扩展仅作为开发来源；
- 安装不得运行 lifecycle scripts；
- 共享锁文件不得包含本机绝对路径和用户授权；
- 用户授权绑定扩展版本、来源、hash、Capability 和作用域。

### FR-014：公共 SDK

首期通过以下入口导出：

```text
@aibyzero/byz/extension
```

公共 SDK 不得暴露 Pi Context、SQLite 表或内部 Session 对象。

### FR-015：CLI 命令注册

BYZ 自有命令统一通过 Command Registry 处理，业务模块返回 `CommandResult`，不直接修改 `process.exitCode`。

新增命令至少包括：

```text
byz project status
byz project resume
byz memory list
byz memory forget
byz extension list
byz extension inspect
byz extension install
byz extension permissions
byz extension revoke
byz extension remove
byz extension doctor
```

## 7. 非功能需求

### 安全

- 不宣传内置系统沙箱；
- 项目边界检查必须处理 symlink；
- 凭证只能通过现有安全存储或请求代理使用；
- 删除记忆后不得在事件、索引和导出中残留原文。

### 可靠性

- SQLite transaction 不覆盖整个模型回合；
- 崩溃后不能产生部分提交的领域状态；
- migration 失败后进入只读降级；
- 两个 Session 并发更新不能静默覆盖决策。

### 可维护性

- 新 BYZ 领域代码使用 TypeScript；
- Domain 测试不启动 Pi；
- 建立架构依赖检查；
- 构建脚本不得手工逐文件维护源码复制清单。

### 可重现性

干净 clone 必须能够通过公开命令：

- 安装依赖；
- 构建；
- 运行非 E2E 测试；
- 生成与发布流程一致的 npm tarball。

## 8. 边缘与异常状态

| 场景 | 行为 |
| --- | --- |
| `project.json` 存在但本机状态丢失 | 提供重新关联、导入或创建新状态 |
| 本机状态存在但项目目录移动 | 通过项目 ID 重新关联工作区 |
| 多个项目使用同一 ID | 提示冲突，不静默合并 |
| Git branch/HEAD 改变 | 进入 `needs-reconciliation` |
| 两个 Session 并发写状态 | 使用版本冲突和重新评估 |
| migration 失败 | 只读打开并提供导出 |
| 扩展 hash 变化 | 停止加载并要求重新批准 |
| 权限被撤销时存在待执行写入 | 取消未执行动作 |
| 外部请求成功但本地记录失败 | 标记结果不确定，不自动重试外部写入 |
| 候选记忆长期未处理 | 到期标记为 expired，不进入上下文 |

## 9. 非目标

- 云同步和多人实时协作；
- 插件市场和远程账号系统；
- 通用项目管理平台；
- 第三方代码的内置系统沙箱；
- 自动远程遥测；
- 自动回滚用户代码；
- 自动接受模型生成的长期记忆；
- 允许扩展直接访问数据库。

## 10. 风险与缓解

| 风险 | 缓解 |
| --- | --- |
| 事件存储增加复杂度 | 只对 Project Core 使用，UI 临时状态不事件化 |
| 记忆误写 | 候选与正式记忆分离 |
| 扩展权限造成虚假安全感 | 明确两级信任和系统权限警告 |
| Pi 升级持续产生冲突 | 建立 Adapter 并泛化 BYZ 专属 hook |
| 状态与真实工作区不一致 | 每次恢复重新扫描和比较 |
| 开源贡献扩大维护压力 | Core RFC/ADR，扩展走普通 PR |
| 构建包与源码不一致 | 分层测试和 tarball smoke |
| 敏感状态难以彻底删除 | 记忆正文与不可变事件分离 |

## 11. 里程碑

### M0：开源准备

- 上游、许可证、安全和贡献文档；
- 仓库区域与所有权说明；
- 可重现构建和打包检查。

### M1：架构边界

- BYZ 新代码迁移 TypeScript；
- Pi Adapter 和通用 managed-resource 能力；
- Conversation Extension 拆分；
- CLI Command Registry。

### M2：Project Core

- Project、Task、Decision、Operation；
- SQLite Repository；
- 领域事件和乐观并发；
- 项目标识和 workspace 映射。

### M3：Memory 与 Checkpoint

- 候选/正式记忆；
- 查看、确认、拒绝和删除；
- 工作区指纹和检查点；
- 崩溃恢复。

### M4：社区扩展协议

- Manifest；
- Capability；
- 来源锁文件；
- 本机授权；
- `@aibyzero/byz/extension`；
- 扩展管理命令。

### M5：稳定性验证

- Repository conformance；
- migration、并发和崩溃测试；
- Pi Adapter 契约测试；
- 最终 npm tarball 外部 smoke。

## 12. 成功指标

- 90% 以上 Project Domain 测试无需 Pi runtime。
- Pi 升级中的 BYZ 冲突主要集中在 Adapter 和构建层。
- 所有正式记忆均能追溯到用户确认或已确认项目事实。
- 崩溃恢复测试不存在任务状态丢失或虚假完成。
- 社区集成无需修改 Project Core。
- 扩展权限变更、版本变更和来源变更均触发重新授权。
- 发布包可从干净 clone 重现。

## 13. 待明确的问题

- 是否为项目状态提供显式加密导出。
- Project schema 和 Extension API 的兼容承诺周期。
- 本地扩展开发模式是否允许自动重载。
- 首期支持哪些官方外部集成作为 SDK 样例。
- BYZ、Pi、CM 和 CM Plugin 的最终版权声明需正式审查。
