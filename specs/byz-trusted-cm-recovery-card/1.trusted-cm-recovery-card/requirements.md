# Trusted CM Recovery Card — 需求规格

## 概述

在受 Pi project trust 保护且存在有效 CM 运行状态的项目中，BYZ 以只读方式聚合项目内 CM 状态与 Pi Session 摘要，并在详情中惰性补充当前 Git HEAD，提供简洁、可追溯且安全失败的恢复卡。

## 项目信息

- 项目名: pi-monorepo / BYZ
- 架构类型: Node.js npm-workspaces monorepo，TypeScript/JavaScript ESM CLI/TUI
- 优先级: P0
- 交付形态: 本地 npm CLI/TUI

## 需求版本

| 日期 | 版本 | 说明 |
| --- | --- | --- |
| 2026-08-31 | v1 | 初始需求 |
| 2026-09-01 | v2 | T-002 两轮安全审查阻塞后改由替代任务继续；功能范围与 AC 不变 |
| 2026-09-01 | v3 | 删除全局 CM 索引和 Git working-tree 摘要，缩小启动证据与验证矩阵 |
| 2026-09-01 | v4 | T-010 两轮阻塞后改用 canonical line protocol 和三条精确回归 |
| 2026-09-01 | v5 | T-003 两轮阻塞后由 tests-only T-012 补齐 reader 验证矩阵 |
| 2026-09-02 | v6 | 增加已知旧版状态兼容、候选级问题归集和 `/project details` 脱敏诊断 |

## 用户故事

- 作为长期维护项目的个人开发者，我想在启动 BYZ 时看到当前 CM 工作及停止原因，以便无需重读聊天记录即可判断下一步。
- 作为开发者，我想核对当前任务、当前审查、Session 摘要与 Git HEAD，以便只基于首版必要事实恢复工作。
- 作为开发者，我想在恢复前看到 CM 状态冲突或来源变化，以便避免从过期上下文继续。
- 作为开发者，我想显式选择查看详情、暂不处理或进入对应 CM 流程，以便 BYZ 不会擅自恢复或执行命令。
- 作为 npm CLI 用户，我想让未信任或恶意项目无法借恢复功能读取项目外文件、终端注入或泄露敏感信息。
- 作为长期升级 BYZ/CM 的开发者，我想让已知旧版终态记录不会破坏当前恢复，并能从 details 定位真正阻塞恢复的项目内状态文件。

## 功能需求

1. [F-001] BYZ 只在当前 Pi context 明确处于 trusted 状态时启动恢复读取；未信任项目不得读取 CM、Git 或 Session 恢复数据。
2. [F-002] BYZ 只对当前 trusted project 的 `specs/` 直属子目录执行有上限、非递归的候选发现；首版不读取 CM 本机私有全局索引，不跨项目定位；所有候选必须 canonical 落在当前 trusted project 内。
3. [F-003] BYZ 首屏只从 CM 现有 manifest、status、run pointer、tasks 和当前任务相关 review header 投影结构化状态；task/review Markdown 只接受 CM 生成的 canonical line protocol，不作为通用 YAML 解析。首版不聚合历史 QA、delivery、完整 review 历史或 `运行日志.jsonl`，不创建第二套 Task、Decision、Checkpoint、Memory 或 workflow 状态源。
4. [F-004] BYZ 必须把结构化证据归并为 `resumable | needs-reconciliation | needs-decision | blocked | unavailable`，冲突、缺失或无法证明的状态不得推断为已完成或可继续。
5. [F-005] BYZ 必须在 adapter 内完成 trust gate 后才允许惰性读取当前 Pi Session 的启动原因/历史存在性；只有 `/project details` 在再次通过 trust gate 后才可通过固定参数、无 shell 的惰性 Git 查询补充当前短 HEAD。首版不运行 `git status`、不统计 working-tree 变化；Session 正文和源码正文不得进入恢复投影。
6. [F-006] BYZ 必须在正常欢迎信息之后异步显示紧凑恢复卡，并提供固定的 `/project status|details|dismiss` 入口；首版动作只显示或隐藏证据与推荐的 CM 入口，不自动执行 CM、Pi、Git 或 shell 命令。
7. [F-007] BYZ 必须在每次读取、重新展示和动作前复查 trust 与项目内证据身份；读取期间 trust、candidate identity 或 run id 变化时丢弃旧结果并要求重新核对。Git HEAD 是 details 当次上下文，不作为启动 snapshot 的一致性门禁。
8. [F-008] 恢复功能的任何损坏、超时、超限或拒绝必须安全降级且不阻塞 BYZ 正常启动；npm 发布包不得新增不必要运行时依赖或携带本机状态、日志、绝对路径、凭据及开发产物。
9. [F-009] Reader 必须只对明确列入 allowlist 的旧版字段形态执行只读规范化；兼容层不得改写项目文件、接受未知 schema version，或把未知状态猜成终态。
10. [F-010] 候选扫描必须归集有界、脱敏的问题证据；自动启动仍只显示一次固定 warning，手动 `/project details` 可显示稳定 reason code 与项目内相对来源路径，不显示原始异常、字段值或绝对路径。

## 非功能需求

- 性能: 恢复读取必须异步，不阻塞 TUI 可交互启动；details 的单次 Git 子进程有固定超时和输出上限，项目候选、review 文件、单文件与 snapshot 总字节均有上限。
- 安全: 项目候选先做 canonical containment 与 lstat，叶子文件使用 final-component no-follow、handle stat 及读取前后 project/specs/leaf identity 检查；拒绝预先存在的 symlink、junction、非普通文件、路径穿越和 canonical 越界。Pi 同一用户信任边界内的并发祖先替换不宣称为保密沙箱；检测到身份变化后整次 snapshot 不得进入投影、UI 或 diagnostics。文本进入 TUI 前移除 ANSI、OSC、C0/C1 与双向控制字符并限制字段长度。
- 隐私: 不读取或展示 `.env`、认证材料、Prompt、模型回答、源码正文、工具参数/输出、原始命令输出或无必要的绝对路径；安全拒绝只输出稳定 reason code 与简短提示。
- 可靠性: 项目直属 specs 内记录是首版唯一 CM 来源；已知旧版形态只在内存中规范化，未知、损坏或冲突状态继续失败关闭，不读取全局镜像补猜，也不自动修复或覆盖来源。候选级问题归集不得让一个目录的异常提前终止其余 bounded scan。
- 兼容性: ordinary Pi 未启用 BYZ 恢复扩展时行为不变；非 CM 项目、无 active CM run 项目和非交互模式不显示恢复卡。
- 供应链: 优先零新增依赖；任何新增依赖都必须精确 pin、审查许可证/安装脚本/维护与安全记录，并同步 lockfile/shrinkwrap 审查。

## 验收标准

- [x] [AC-001] trusted、interactive 且存在唯一有效 active CM run 时，BYZ 在欢迎信息后展示包含当前 Feature/Task、CM node/state、归并状态和推荐下一入口的恢复卡。
- [x] [AC-002] untrusted context 下，项目 specs、Git 和 Session recovery reader 的可观察调用次数均为 0，且不显示恢复卡或项目元数据。
- [x] [AC-003] 非 CM 项目、没有 active/未决 CM run、普通 Pi 入口和 BYZ 非交互模式保持原行为，不产生恢复提示。
- [x] [AC-004] locator 不读取 `~/.cm-workflow` 或 `CM_WORKFLOW_LOG_HOME`，只接受 canonical 位于当前 trusted project `<root>/specs/<one-direct-child>` 的候选。
- [x] [AC-005] locator 最多枚举 64 个 `specs/` 直属目录且不递归；两个及以上 active/未决候选返回 `needs-decision`，不得按目录名、mtime 或文本内容静默选一个。
- [x] [AC-006] 预先存在的 symlink、junction、非普通文件、路径穿越和项目外 specs 在读取前被拒绝；读取期间 project/specs/leaf identity 变化时整次 snapshot 被废弃，已读取字节不得进入投影、UI 或 diagnostics。
- [x] [AC-007] CM status、task checkbox 和当前任务 review verdict 只按各自结构化字段投影；review authority 仅接受唯一的 `key: value` canonical 行。frontmatter 中出现 quoted/escaped key、YAML explicit-key 标记行（`?`/`:`）或受保护 key 的非 canonical 冒号空白时整项拒绝，不解码或比较 YAML 语义；自由文本 detail 不能改变归并状态或动作，首版不读取 QA/test/delivery 事件。
- [x] [AC-008] blocked review、awaiting spec approval、paused_for_human、完成凭证缺失和 task/review 冲突分别得到 `blocked`、`needs-decision` 或 `needs-reconciliation`，不能得到 `resumable`；任一 review task 与选定当前 task 不同必须直接冲突，任何以 task checkbox 前缀开头但不符合 canonical task 行的输入必须使整个 task 来源不可用。
- [x] [AC-009] `resumable` 只表示可以重新进入对应 CM workflow 并由 CM 机械门禁复核，不表示 review/implementation 仍有效或任务可直接标记完成；当前任务 review 只能显示“历史记录，未重验”，冲突则进入 `needs-reconciliation`。
- [x] [AC-010] Git 只在 `/project details` 中惰性投影当前短 HEAD；不读取 branch、working-tree 状态、文件名、diff、remote URL 或原始 stdout/stderr。
- [x] [AC-011] Git 只允许固定 `git rev-parse --verify HEAD` 参数数组，设置 `GIT_OPTIONAL_LOCKS=0`、`GIT_TERMINAL_PROMPT=0`、`shell: false`、超时和输出上限；Git 不存在、仓库损坏、超限、超时或退出非零时只标记 unavailable，不阻塞启动，也不执行项目代码或 shell 字符串。
- [x] [AC-012] Session 投影只包含 session start reason 与是否已有历史，不包含消息正文、Session 文件绝对路径或模型内容；untrusted context 构造/分发 RecoveryContext 时不得调用 `getEntries()`，惰性 session summary 自身也必须复查 trust。
- [x] [AC-013] 恢复卡默认不调用 Git 或显示 commit SHA；`/project details` 才惰性读取并显示当前短 HEAD、相对证据路径与当前任务的结构化 review 摘要。
- [x] [AC-014] `/project dismiss` 只在当前 Session 生命周期内停止自动提醒；`/project status` 可重新展示，new/resume/fork Session 可再次展示，reload 不重复弹卡。
- [x] [AC-015] `/project` 未知参数只显示固定用法；任何 CM 文件内容都不能生成命令名、参数、路径或自动执行行为。
- [x] [AC-016] 每次 status/details/dismiss 与建议继续前都重新检查 trust；trust 撤销后清除缓存投影且不再读取或显示旧详情，details 必须在复查通过后才启动 Git。
- [x] [AC-017] ANSI、OSC、换行伪造、双向文本控制符、C0/C1 控制符和超长字段进入 UI 前被移除/截断，恶意内容不能伪造卡片边界或终端动作。
- [x] [AC-018] 超过候选目录数、review 文件数、单文件大小或 snapshot 总字节上限的来源被标为 unavailable/needs-reconciliation；实现不得先整文件或整 snapshot 读入后再检查限制。`.cm-run.json.status == "done"` 但 `.cm-specs-status == "awaiting_review"`、paused/blocked 状态或当前 review 仍未决时仍必须成为候选。
- [x] [AC-019] 任一恢复 reader 抛错、解析失败或取消时，BYZ 欢迎、输入和普通 Conversation/Fast/Prewalk/workflow 行为仍可用；安全拒绝仅显示一次简短 warning 并记录无路径/内容的本地 diagnostics reason code。
- [x] [AC-020] Recovery facade 是冻结的 plain object，只暴露声明的 event/command/context 能力，不包含 raw Pi API、SessionManager handle、filesystem handle 或 managed-resource replacement。
- [x] [AC-021] 最终 npm tarball 在仓库外、隔离 HOME 中安装启动后，恢复卡可读取合成的安全 CM fixture；包内不含项目 specs、运行日志、本机绝对路径、密钥或未声明开发依赖。
- [x] [AC-022] 首版不增加运行时依赖、不安装 watcher/hook/daemon、不写项目状态；若实现阶段证明必须新增依赖或写入事实源，规格必须回到人工变更审批。
- [x] [AC-023] 兼容层只接受三种已知旧形态：`.cm-specs-status.schema_version` 缺失或严格等于 `1`，`.cm-status.json.task` 为 `null` 时按未指定处理，`.cm-status.json.state == "completed"` 时按 `run_done` 处理；其他未知附加字段、schema version、状态或错误类型继续返回 `invalid_record`，且不写回来源。
- [x] [AC-024] Candidate scan 在 64 目录、4 review、单文件与总字节预算内继续检查全部直属候选并归集最多 8 个问题；已证明为 `run.status == "done"`、spec status 非待审、CM terminal state 且没有未决 task/review 的候选静默 absent。`task: null` 只表示当前任务未指定，若 canonical tasks 中仍有一个或多个未完成任务，该候选必须进入 reducer 并得到 reconciliation/actionable 结论，不能静默 absent。任何 running、awaiting_review、paused、blocked 或无法证明为终态的损坏候选仍阻止唯一 `resumable` 结论，不能因另一个候选有效而被忽略。
- [x] [AC-025] 自动启动遇到不可用恢复状态时仍只显示一次固定 warning；随后执行 `/project details` 会重新读取并显示 `Project recovery unavailable`、allowlist reason code 和最多 8 条安全相对来源路径。输出不得包含原始异常、记录字段值、绝对路径、Session 正文或额外 Git 查询；未知参数与 `/project status` 行为保持不变。

## 依赖

- CM Workflow 项目内状态合同：`.cm-specs-status`、`.cm-status.json`、`.cm-run.json`、`tasks.md` 与当前任务相关 `.reviews/` header。
- Pi project trust、extension lifecycle、Session start reason 与 read-only Session context。
- 系统 Git 可执行文件；不可用时允许降级。
- Node.js 标准库；首版不新增第三方运行时依赖。

## 复用与不采用

- 直接复用 CM 项目内任务、状态和当前 review/handoff；历史 QA、delivery、全局索引与运行日志聚合推迟到 P1，不复制 projectmem/Brigade 的事件库。
- 直接复用 Pi project trust 与 Session lifecycle，不新建授权或 Session 系统。
- 借鉴 projectmem 的 session-start brief 交互，但不引入 Python、Git hooks、watcher 或 repo-local memory。
- OwnMem 的候选/证据治理留给后续 P1；Beads task graph 与 Brigade control plane 和 CM 重复，本 P0 不引入。

## 变更记录

- `[v2]` T-002 的两轮实现审查均未满足未知/部分 schema 失败关闭要求，原任务停止且不得创建 attempt 3。
- `[v2]` 后续只能由重新审批的替代任务完成同一 P0 合同；T-002 的代码与历史 review 均不能作为当前批准或完成凭证。
- `[v2]` 功能需求、用户行为、22 条 AC、运行时依赖和只读边界均不变。
- `[v3]` 删除全局 CM index 路径与完整运行日志/QA/delivery 聚合；当前项目直属 specs 成为首版唯一候选来源。
- `[v3]` Git 缩减为 details 下的当前短 HEAD；branch、working-tree 摘要、fsmonitor/hooks/index 防御矩阵推迟到 P1。
- `[v3]` 保留 trust-first、strict parser、bounded no-follow、terminal sanitizer、状态冲突与最终 npm 隔离验证。
- `[v4]` T-010 两轮审查后仍有3条失败开放路径，停止且禁止 attempt 3；新 T-011 只修复 explicit-key、review-task mismatch 和 malformed task-shaped line。
- `[v4]` review header 定义为 CM canonical line protocol，不引入 YAML parser，也不承诺识别所有 YAML 等价表达；任何非 canonical key 形态直接拒绝。
- `[v5]` T-003 的 header-only 实现问题已修复，但第二轮因 TC-003/TC-004 测试矩阵不完整而停止；T-012 只补 done/actionable 生命周期、project/specs/leaf identity 和非普通文件/平台可用 junction 回归，不扩展 reader 行为。
- `[v6]` 新增只读兼容三元组：manifest `schema_version: 1`、status `task: null`、status `state: completed`；兼容范围封闭，不升级为宽松 parser。
- `[v6]` Reader 不再遇到首个候选错误就丢失后续问题证据；最多归集 8 条 reason/path，并保持潜在 active 损坏候选失败关闭。
- `[v6]` 自动 warning 继续固定且不暴露细节；只有手动 details 可查看脱敏问题卡，不增加 Git、全局 CM 或 Session 正文读取。
- `[v7]` T-013 第二轮独立审查发现 `task: null` + terminal alias 会隐藏多个未完成任务，原任务停止且禁止 attempt 3；经人工批准的 T-016 作为独立替代任务，只补该红灯回归与最小 actionable 判定。

## 已确认默认

- 短 commit SHA 仅在 details 中显示，紧凑卡默认隐藏。
- dismiss 仅对当前 Session 生效，不持久化新偏好。
- 安全拒绝同时显示一次简短 warning 并写本地、无敏感内容的 diagnostics reason code。

## 开放问题

- 无。任何需要新增运行时依赖、项目写入或非 CM 项目支持的发现都视为范围变化，必须重新人工审批。
