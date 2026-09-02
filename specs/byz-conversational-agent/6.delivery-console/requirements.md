# Delivery Console — 需求规格

## 概述

在任务完成后提供一个显式 `/deliver` 控制台，基于 registry、Git 和审查证据展示可交付状态，并为 commit、push、PR 和 merge 分别建立一次性人工确认；生产发布 V1 仅展示就绪状态和待决清单。

## 项目信息

- 项目名: pi-monorepo
- 架构类型: npm workspace monorepo；BYZ CLI/TUI 产品层 + 本地 Git/GitHub CLI
- 交付形态: 本地终端 CLI
- 本批执行: 否；依赖 Feature 4 稳定后另行批准

## 需求版本

| 日期 | 版本 | 说明 |
| --- | --- | --- |
| 2026-09-02 | v1 | 初始需求；生产发布只读待决 |

## 范围

**做：** trusted-project 下的只读交付快照、当前计划文件范围、测试/审查 provenance、一次性 intent、逐动作确认、受控 commit/push/GitHub PR/PR merge、状态变化重确认和 release readiness。

**不做：** 自动发布 npm/生产；基础设施变更；强制绕过分支保护；任意 shell 权限沙箱；自动 stage 其他 Session/用户文件；操作 `upstream`；在 startup 自动运行 Git。

## 用户故事

- 作为完成开发的用户，我想一处看到改了什么、验证到什么程度和当前分支状态，以便判断能否交付。
- 作为多 Session 工作的用户，我想确保 commit 只包含当前计划观察到的文件，以免覆盖其他工作。
- 作为执行远端动作的用户，我想在 push、PR、merge 前分别看到准确目标并确认，以便避免一次授权被跨动作复用。
- 作为发布负责人，我想看到发布还缺哪些检查，但不希望控制台自行发布生产版本。

## 功能需求

1. [F-001] `/deliver` 与 `/deliver status` 必须只读构建当前交付快照：registry plan/task/evidence、workspace-relative changed paths、HEAD、branch、`origin` 跟踪关系、commit/push/PR/merge/release readiness；不得在 startup 自动运行 Git。
2. [F-002] 交付控制台仅在 trusted project 可用；所有路径必须经 workspace containment、realpath/symlink 和 Git root 边界验证，默认 compact 不显示绝对路径。
3. [F-003] 可提交范围必须是“当前 sealed plan 观察到且 post-mutation content digest 仍匹配的 workspace-relative mutation paths”与当前 Git diff 的交集；pre-existing/unobserved dirty、在最后一次 observed mutation 后又变化的路径、untracked、staged 或冲突文件必须排除并明确阻塞对应动作。
4. [F-004] 测试、build、review 和 QA 状态必须保留 provenance；只有 verified receipt 可显示“通过”，declared/observed generic/unknown 分别显示未验证或未知。
5. [F-005] `/deliver commit` 必须预览精确文件列表和 commit message，生成绑定当前 HEAD、index、worktree fingerprint、planId 与 action 的一次性 intent；用户明确确认后才能 stage 精确路径并 commit。
6. [F-006] `/deliver push` 必须预览 remote、branch、upstream 和将推送的 commit；V1 默认只允许 `origin`，任何 `upstream` 或未知 remote 必须拒绝，确认不能沿用 commit intent。
7. [F-007] `/deliver pr` 必须在 branch 已推送、GitHub origin 可识别且 CLI 可用时预览 base/head/title；确认后创建 draft PR，并只在远端成功后记录 receipt。
8. [F-008] `/deliver merge` 只支持已存在的 GitHub PR，在 required checks 可证明通过、无冲突、目标分支符合项目策略时预览 merge 方法；必须单独确认后通过 PR 通道合并，不直接本地改写 main 或绕过保护。
9. [F-009] 每个高影响 action 在执行前必须重新读取 Git/remote 状态并校验 intent fingerprint；fingerprint 至少绑定 HEAD、index/worktree closed status、candidate content digests、branch/upstream、origin identity、remote branch OID、registry generation，并在 PR/merge 时绑定 PR number/head/base SHA、mergeability 与 required-check conclusions。任一变化都使 intent 失效并要求重新确认。
10. [F-010] action 失败、取消、超时或部分成功必须显示已发生副作用与未完成步骤；不得把“配置了命令”或“本地成功”冒充远端成功。
11. [F-011] `/deliver release` V1 只读显示 changelog、正式测试、构建、外部安装 smoke、版本/tag 和人工审批待决项；不得调用 release script、npm publish、tag、生产迁移或基础设施动作。
12. [F-012] Delivery receipt 可写入 Session custom entry，但不得保存凭据、remote URL 中的认证信息、命令输出、diff、PR body、绝对路径或 token；Git/远端仍是最终事实源。
13. [F-013] 控制台必须明确声明它是 BYZ workflow gate 而非 OS/Git 权限沙箱；用户仍可在控制台外运行 shell，功能不得声称阻止所有任意命令。

## 非功能需求

- 安全: 每动作单独确认、intent 一次性且有界时效；无 `--force`、无 force push、无 `--no-verify`、无 credential 参数、无 shell 字符串拼接。
- 可靠性: Git/gh 子进程使用参数数组、超时和 exit/status closed projection；remote side effect 只有观察成功后记 receipt。
- 兼容性: 不改变现有自然语言 Git 工作流、Pi bash、project recovery 和 release scripts；V1 GitHub-only，其他 host 明确不可用。
- 隐私: compact 不显示路径；details 只显示 workspace-relative paths、safe branch/remote aliases 和 bounded status，不显示 remote credential、diff 或输出正文。
- 性能: startup 零 Git；显式命令按需执行有界 Git/gh 查询，不新增 watcher、轮询或后台进程。
- 依赖: Feature 4 registry；不新增 npm 依赖，复用 Node child process/Git/可选 `gh`。

## 验收标准

- [ ] [AC-001] startup 与普通 turn 不运行 Git；显式 `/deliver status` 才读取一次 bounded 交付快照。
- [ ] [AC-002] untrusted project、Git root 越界、symlink escape 或无法证明 origin 时所有 mutation action 拒绝，且不读取 diff 正文。
- [ ] [AC-003] 当前 plan 观察到 A/B 并记录 post-mutation digest，但另一 Session 随后改写 B、工作树另有用户文件 C 时，commit preview 只含 digest 仍匹配的 A，把 B/C 列为 excluded；不能 stage B/C。
- [ ] [AC-004] declared “tests passed” 不显示为通过；verified test/check/build/review receipt 分别显示准确状态与未知项。
- [ ] [AC-005] commit intent 绑定精确路径和状态；确认前零 stage/commit，确认后只提交预览路径并记录真实 commit SHA。
- [ ] [AC-006] push intent 只允许 origin/current branch；upstream、force、detached HEAD、未知 tracking 或状态漂移均阻塞且无远端副作用。
- [ ] [AC-007] draft PR 只有在 branch 已推送且 GitHub/gh 可用时创建；失败或未观察到 URL/number 时不记录成功。
- [ ] [AC-008] merge 必须通过已存在 PR、checks 通过和单独确认；不能复用 PR 创建确认，也不能本地直接 push main。
- [ ] [AC-009] 任一确认后修改 HEAD/index/worktree/candidate digest/branch/upstream/origin/remote ref/registry generation，或改变 PR head/base/checks/mergeability，原 intent 失效且 action 要求重新预览确认。
- [ ] [AC-010] action 取消、超时、命令失败和“push 成功但 PR 创建失败”均逐项报告已发生/未发生，不显示整体完成。
- [ ] [AC-011] `/deliver release` 只显示 readiness 与待决清单，测试中断言没有 release、tag、npm publish、迁移或基础设施命令。
- [ ] [AC-012] Session receipt 和默认输出不含绝对路径、remote credentials、diff、命令输出、PR body、Prompt 或 tool result。
- [ ] [AC-013] 没有 registry sealed plan、verified evidence 或 clean scoped diff 时，控制台保持只读并准确显示阻塞原因，不猜成功。
- [ ] [AC-014] fake Git/gh runner 和临时 bare remote 覆盖 commit/push/PR/merge 正常流、状态漂移、失败和清理；测试不得访问真实 remote。
- [ ] [AC-015] 80×24 TUI 中摘要可读，高影响预览通过显式 details/confirmation 展开，不挤入默认单行执行状态。

## 依赖

- Feature 4 `structured-execution-registry` 的 sealed plan、mutation paths 与 evidence provenance。
- Pi trusted-project、extension command UI 和 Node child process 能力。
- Git；PR/merge V1 可选依赖本机 `gh`，缺失时 fail closed。
- 项目既有 Git/发布规则仍是权威约束。

## 开放问题

- 无。已确认生产发布 V1 只展示 readiness/待决清单，不自动执行。
