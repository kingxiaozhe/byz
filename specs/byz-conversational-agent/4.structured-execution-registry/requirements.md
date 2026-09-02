# Structured Execution Registry — 需求规格

## 概述

为 BYZ 增加 Session-scoped 的结构化任务与验证证据注册表，使执行状态只在存在可证明计划和运行时证据时展示真实步骤进度，并为暂停续跑与交付控制台提供统一事实源。

## 项目信息

- 项目名: pi-monorepo
- 架构类型: npm workspace monorepo；BYZ CLI/TUI 产品层 + Pi extension runtime
- 交付形态: 本地终端 CLI
- 本批执行: 是；作为后续 Feature 5、6 的基础，首次 `cm-ai` 只执行本 Feature

## 需求版本

| 日期 | 版本 | 说明 |
| --- | --- | --- |
| 2026-09-02 | v1 | 初始需求 |

## 范围

**做：** 封闭任务计划、合法状态迁移、计划封口、运行时工具证据、验证证据 provenance、Session custom entry 恢复、真实 `current/total/completed` 展示和失败关闭。

**不做：** 从模型自然语言推导任务；把 CM specs tasks 冒充 runtime tasks；项目级/全局任务数据库；跨 Session 合并；百分比估算；生产发布执行。

## 用户故事

- 作为等待长任务的用户，我想只在 BYZ 已建立完整计划时看到真实步骤位置，以便不被虚假 Tasks 或百分比误导。
- 作为恢复同一 Session 的用户，我想保留已声明任务和验证证据，以便知道上次做到哪里，而不是重新猜测。
- 作为审查执行结果的用户，我想区分 Agent 声明、运行时观察和可验证证据，以便不把模型自述当成已验证事实。
- 作为后续暂停和交付功能的使用者，我想让它们消费同一份结构化状态，以便各界面不会出现互相矛盾的任务事实。

## 功能需求

1. [F-001] BYZ 必须提供一个 managed、closed-schema 的 execution registry 接口，接受计划建立、任务状态迁移和证据声明；不得解析 Prompt、assistant 正文或 tool result 推导任务。
2. [F-002] 每个计划必须使用 host 生成的稳定 `planId` 和唯一任务 ID；任务状态只允许 `pending → active → completed|blocked|cancelled` 及明确的 `blocked → active` 恢复，不允许跳跃、倒退或重复计数。
3. [F-003] 计划只有在显式 seal 且任务总量为 1–64、任务 ID 唯一、顺序固定时，才成为可展示总量的 `sealed` 计划；未封口、损坏、重复或越界计划不得显示 total、ordinal 或完成比例。
4. [F-004] 默认紧凑状态只可在 sealed 计划存在唯一 active task 时追加 `步骤 {ordinal}/{total}`；没有可靠 ordinal 时省略，不显示百分比、任务标题或 CM specs task 数。
5. [F-005] 注册表必须区分 `declared`、`observed` 和 `verified` provenance。模型提交的状态只属于 declared；合法 Pi tool lifecycle 绑定到当时 active task 后才形成 observed receipt；只有 runtime-owned formal test event 或可信 workflow receipt 才可标为 verified。
6. [F-006] observed tool receipt 只能保存稳定 toolCallId、固定工具类别、成功/失败、关联 taskId 和单调顺序；不得保存命令、参数、路径、tool result、Prompt、响应正文或自由文本错误。
7. [F-007] 固定 classifier 只能把 observed command 分类为 test/check/build/git/generic 和成功/失败，不能单独升级为 verified 或“测试通过”；无法证明类别时保持 generic。可信 workflow receipt 还必须通过来源、generation、task 和测试合同绑定后才可 verified。
8. [F-008] accepted registry transition 必须先将 closed-schema custom entry 原子追加到现有 Session transcript，再提交内存状态并发布 snapshot；append 失败时 transition 不得对用户可见。entry 不进入模型上下文；同一 Session startup/resume/reload 时按顺序重放并失败关闭，不能写入项目文件、全局记忆或第二套数据库。
9. [F-009] 重放遇到 schema 不支持、序号断裂、未知 plan/task、非法迁移或越界字段时，当前候选计划必须标为 unavailable；损坏计划不得被后续自述覆盖为完成，用户可显式开始新 plan。
10. [F-010] `agent_end`、取消、异常、compaction、reload 和 Session shutdown 不得伪造任务完成；只有 accepted transition 能改变任务状态，运行时结束只收口 in-flight receipt。
11. [F-011] 完成摘要在 sealed 计划存在时可显示 `完成 {completed}/{total}`、blocked 数和 verified evidence 数；未知或零证据字段按规则省略，不把 observed generic tool success 写成“测试通过”。
12. [F-012] 注册表必须提供只读 snapshot 给 Conversation、Pause 和 Delivery feature；消费者不能绕过 registry reducer 直接修改状态。

## 非功能需求

- 性能: 单次 transition 与 snapshot 为有界 O(任务数)，任务最多 64、evidence receipts 最多 128；不得扫描完整 Session 正文或新增轮询 timer。
- 安全: closed schema；ID/label 长度、字符和集合规模有界；默认状态不显示 label、路径或 raw payload；Session entry 不存储工具入参/结果。
- 兼容性: 没有 registry plan 时，Turn Token Usage v3 状态和非交互命令逐字保持现有行为；Pi 普通用户和未注册 managed tool 时行为不变。
- 可靠性: duplicate、parallel、out-of-order、stale generation 和 replay 必须幂等或失败关闭；计数只能是非负安全整数。
- 依赖: 不新增运行时依赖、网络请求或项目状态文件。

## 验收标准

- [ ] [AC-001] 没有 plan 或 plan 未 seal 时，现有单行状态不出现 `步骤`、Tasks、total 或百分比。
- [ ] [AC-002] 建立 4 个唯一任务并 seal 后，第二个任务成为唯一 active 时显示 `步骤 2/4`；完成摘要显示准确 completed/total，不显示任务标题。
- [ ] [AC-003] total 为 0、超过 64、重复 taskId、seal 后追加任务或同时激活两个任务均被拒绝或使候选 unavailable，界面不显示伪造 ordinal。
- [ ] [AC-004] 合法迁移按固定状态机生效；重复 transition 幂等，未知 plan/task、非法倒退和 stale generation 不改变 snapshot。
- [ ] [AC-005] 两个并行工具按 toolCallId 绑定到开始时的 active task，乱序结束只形成两条 observed receipt；重复/未知 end 不重复计数。
- [ ] [AC-006] tool receipt 和 Session custom entry 不含命令、参数、路径、result、Prompt、响应正文或自由错误文本。
- [ ] [AC-007] 模型声明 `tests passed` 但没有可信 receipt 时保持 declared；固定 classifier 观察到成功测试命令后只产生 categorized observed evidence，不能显示“测试通过”；只有绑定测试合同的 runtime/workflow receipt 可 verified，失败命令不能产生 pass。
- [ ] [AC-008] append Session entry 失败时 transition 和 snapshot 都不变化；append 成功后同一 Session reload/resume 重放得到相同 sealed plan、task states 和 evidence counts，且不触发模型、网络或项目文件读写。
- [ ] [AC-009] 重放包含未知 schema、断裂 sequence、非法迁移或越界数组时失败关闭并显示安全 unavailable 状态；开始新 plan 后才能恢复。
- [ ] [AC-010] 正常完成、取消、异常、compaction 与 shutdown 只收口运行时 receipt，不自动把 active/pending task 标成 completed。
- [ ] [AC-011] 没有 registry 数据时，现有 2 秒延迟、工具计数、Token、Footer、details、中英文和非交互输出回归通过。
- [ ] [AC-012] compact renderer 只读取 bounded snapshot；恶意 label、路径和命令不能进入默认单行、完成摘要或 diagnostics。
- [ ] [AC-013] registry 数据只进入现有 Session custom entries，不新建项目/全局存储，不进入模型上下文，也不写入 BYZ diagnostics。
- [ ] [AC-014] 80×24 TUI 中 `步骤 64/64` 与现有状态、耗时、Token 保持单行；无可靠 total 时字段完整省略。
- [ ] [AC-015] Conversation、Pause、Delivery 消费的是冻结只读 snapshot，外部对象修改不能改变 registry 内部状态。

## 依赖

- `packages/byz/src/conversation/conversation-extension.js` 的结构化状态 selector 与紧凑 renderer。
- `packages/byz/src/adapters/pi/pi-runtime-adapter.ts` 的 managed capability facade。
- Pi extension `registerTool`、tool lifecycle 与 `appendEntry`/Session custom entries。
- Feature 5 `safe-pause-resume` 和 Feature 6 `delivery-console` 依赖本 Feature；本 Feature 不依赖它们。

## 开放问题

- 无。已确认首次 `cm-ai` 只开发本 Feature；Feature 5、6 仅完成规格设计并保持待后续单独批准。
