# Turn Token Usage — 需求规格

## 概述

在 BYZ 现有当前阶段耗时和当前回合已观测 Token usage 基础上，提供低噪声、可验证的实时执行状态：默认单行展示状态、运行中工具、耗时和 Token，完成时补充 BYZ 模型活跃时间与工具调用摘要。

## 项目信息

- 项目名: pi-monorepo
- 架构类型: npm workspace monorepo；BYZ CLI/TUI 产品层
- 交付形态: 本地终端 CLI

## 需求版本

| 日期 | 版本 | 说明 |
| --- | --- | --- |
| 2026-09-01 | v1 | 新增当前回合 Token usage 进度与完成摘要 |
| 2026-09-01 | v2 | 明确 mandatory all-zero placeholder 保持不可用 |
| 2026-09-02 | v3 | 优化执行状态文案，增加运行中工具计数与 BYZ 模型活跃时间摘要 |

## 用户故事

- 作为正在等待长任务的用户，我想在阶段耗时旁看到当前回合已经确认的输入与输出 Token，以便判断本轮资源消耗。
- 作为关注成本透明度的用户，我想区分输入、输出、缓存读取和缓存写入，以便避免把不同口径误认为一个总 Token。
- 作为使用不同 Provider 的用户，我想让缺失 usage 保持明确不可用，以便界面不把估算值或未知值当成事实。
- 作为等待长任务的用户，我想一眼看到 BYZ 当前是在思考、执行工具、等待确认还是整理答复，以便判断任务是否仍在推进。
- 作为关注执行透明度的用户，我想看到当前运行中的工具数量，并在结束时看到模型活跃时间和工具调用次数，以便区分模型、工具与人工等待。
- 作为普通用户，我不想看到不可靠的 Tasks 数量、虚假百分比、命令、参数或路径，以免把内部实现细节误认为真实进度。

## 功能需求

1. [F-001] Agent 执行超过 2 秒后，默认 working message 必须以单行显示当前状态、本轮总耗时与当前回合已观测 Token 总量；Token headline 只计算安全的 `input + output`，不把 cache usage 混入。`[v3 修改: 从输入/输出多行展示改为低噪声单行总量]`
2. [F-002] 当前回合 usage 必须在 `agent_start` 清零，并随着本回合模型响应的 usage 到达而分段更新；不得把进入本回合前的 Session 历史 usage 计入。
3. [F-003] 正常完成摘要必须以固定两行显示总耗时和当前回合 Token headline，并补充 BYZ 模型活跃时间、累计工具调用数、失败数和非零人工等待时间；详情仍可显示输入、输出、缓存读取和缓存写入，Footer 继续保持 Session 累计口径。`[v3 修改: 增加模型/工具/等待摘要]`
4. [F-004] 只能展示 Pi/Provider 返回且可证明已观测的 usage。尚未观测到 usage、Provider 不提供 usage、字段非法，或 mandatory usage 对象只有全零且没有独立 presence 证据时，必须显示不可用或省略对应字段，不得估算、推断或将未知值显示为零；同一 payload 中只要至少一个字段为正，其他显式合法零字段保留为 observed `0`。`[v2 修改: 明确 all-zero placeholder 与 mixed observed zero 的边界]`
5. [F-005] 展示不得增加模型调用、网络请求、持久化、诊断事件或额外 interval；复用现有单一 1 秒刷新和 progress timeout。默认紧凑 renderer 不得暴露 Prompt、模型响应、Provider payload、凭据、命令、参数、tool result 或文件路径；用户显式开启的详情模式可保留既有经清理活动信息，但不得改变状态/时间/Token 事实口径。
6. [F-006] tool/message/confirmation 事件必须先更新底层信号，再由单一 selector 按 `等待确认 > 工具运行 > 重试/异常 > BYZ 思考 > 整理答复 > 完成` 派生显示和计时 stage；任一合法工具仍在 in-flight 时，assistant update 或无法配对的工具事件不得覆盖工具状态或把工具时间计入模型活跃时间。
7. [F-007] 当前运行工具数必须由合法 `toolCallId` 的 `tool_execution_start/end` 配对得到，支持并行和乱序结束；完成摘要的工具总数与失败数只计一次。未知、缺失或无法配对的事件不得改变工具数量、工具 stage 或累计统计。
8. [F-008] “BYZ 思考”必须定义为客户端可观测的模型活跃区间聚合，不代表或展示 chain-of-thought；工具执行和人工确认时间不得计入该值。
9. [F-009] v3 不显示 Tasks 数量，也不新增 runtime task registry。只有未来存在可证明的 `active/total/completed` 任务源时才可另行审批加入，CM specs task 数不得冒充当前回合任务。
10. [F-010] 紧凑模式保持单行并按每秒最多一次刷新；详情模式可保留现有目标、进展、边界和分项 usage，但不得改变紧凑模式的数据口径。

## 非功能需求

- 性能: 复用现有每秒 working-message interval 和单一 progress timeout；默认 2 秒前不发布自定义状态行，不得每秒扫描完整 Session 历史，也不得按 streaming delta 高频重绘。
- 准确性: 只接受有限、非负的 usage 与稳定 toolCallId；mandatory 全零对象在没有独立 presence 证据时不建立 observed presence，mixed payload 中的显式零字段仍保留；多次 streaming 更新不得重复累计同一模型响应；Token headline 相加、工具配对和模型活跃区间均失败关闭。
- 兼容性: 保留确认等待、Footer Session 累计、Thinking level 热更新、详情模式、语言偏好和非交互命令行为；紧凑 working message 与完成摘要按 v3 明确变更。
- 安全: Adapter 继续只投影 bounded usage 和既有 toolCallId/toolName；默认 renderer 不消费 args、result、Prompt、响应正文或 Provider payload。
- 依赖: 零新增运行时依赖。

## 验收标准

- [x] [AC-001] Agent turn 在 2 秒内完成时不发布自定义执行状态；超过 2 秒且尚未观测 usage 时，单行显示 `BYZ 思考中 · {耗时} · Token —`，不会显示历史 Session usage 或伪造零。`[v3 修改]`
- [x] [AC-002] 第一次模型响应返回 usage 后，单行 Token headline 显示该回合安全累计的 `input + output`；后续工具执行期间继续保留已确认值，cache usage 只在详情/完成分项中出现。`[v3 修改]`
- [x] [AC-003] 同一模型响应的多次 streaming update 只替换当前响应快照，不重复累加；本回合发生多次模型响应时，各响应 usage 恰好累计一次。→ 已通过自动测试验证
- [x] [AC-004] `agent_end` 后只产生一份固定两行完成摘要：第一行含完成、总耗时和 Token headline；第二行含 `BYZ 思考了 {时间}`、工具总数、可选失败数与非零等待时间。mandatory standalone all-zero 保持 `Token —`，分项 usage 在详情中保留既有 observed-only 口径。`[v3 修改]`
- [x] [AC-005] Session Footer 仍显示 Session 累计 usage；当前回合展示不会改变 Footer 数值、Thinking 信息或左右区域优先级。→ 已通过自动测试与 80 列 TUI 验证
- [x] [AC-006] 缺失 usage 或只返回 mandatory all-zero placeholder 的 Provider 显示 `Token —`；缺失单个可选字段时只省略该字段，不补估算值。→ 已通过自动测试验证 `[v2 修改: 明确 all-zero placeholder]`
- [x] [AC-007] NaN、Infinity、负数、字符串、单值超出安全整数范围以及多个合法值相加后的安全整数溢出均失败关闭；受影响字段不进入进度区、完成摘要或累计值。→ 已通过自动测试验证
- [x] [AC-008] Pi 在正常完成、取消、异常和 `session_shutdown` 路径必须清理 usage、in-flight tools、工具统计、模型活跃计时与现有 timer；新回合从 unknown/zero 内存状态开始。`[v3 修改]`
- [x] [AC-009] 实现不新增网络、模型调用、存储、诊断写入或额外 interval；复用现有一个 interval 和一个 timeout，tool/message 事件只在状态或 observed usage 变化时触发必要重绘。`[v3 修改]`
- [x] [AC-010] 80 列真实 TUI 中默认状态保持单行，状态、运行工具数、总耗时和 Token 不发生换行伪造或不可读截断；`--version`、workflow 管理等非交互输出保持不变。`[v3 修改]`
- [x] [AC-011] 无工具运行且模型阶段活跃时显示 `BYZ 思考中`；一个或多个合法工具活跃时显示安全状态与 `{N} 个工具运行`。工具仍运行时收到 assistant update 不得切到 reply；工具全部结束后才按 recover/reply/think 信号恢复模型状态。
- [x] [AC-012] 两个不同 toolCallId 并行开始并乱序结束时，in-flight 计数严格为 `1 → 2 → 1 → 0`；重复 start/end、未知或缺失 ID 不得导致负数、重复累计、伪造运行数量或覆盖已有合法工具 stage。
- [x] [AC-013] 完成摘要中的 BYZ 思考时间只聚合客户端模型活跃阶段，明确排除工具执行与人工确认；总耗时仍等于 active 加 waiting，任何分项不得超过总耗时。
- [x] [AC-014] 工具完成摘要按本轮唯一 start 统计总调用数，按匹配 end 统计失败数；没有工具或等待时隐藏对应字段，不显示 `工具 0`、`等待 0秒`。
- [x] [AC-015] 默认紧凑状态不出现 `Tasks`、进度百分比、toolName、命令、参数、文件路径、tool result、Prompt 或响应正文；只有用户显式开启的详情模式可继续显示既有经清理活动信息，且不得改变状态/时间/Token 事实口径。
- [x] [AC-016] 中文与英文固定文案、2 秒延迟、每秒刷新和完成摘要使用同一状态机与数值；语言切换、detail preference、Footer thinking level 和 Session usage 均不回归。

## 依赖

- `packages/byz/src/conversation/conversation-extension.js` 现有阶段耗时与 Footer usage 格式化逻辑。
- `packages/byz/src/adapters/pi/pi-runtime-adapter.ts` Conversation capability facade。
- Pi extension 的 `message_update`、`message_end` 与 `agent_end` 生命周期 usage。

## 开放问题

- 无。v3 已确认采用“紧凑状态 + 运行工具数 + 本轮耗时 + observed Token headline；完成补充 BYZ 模型活跃时间与工具统计；不显示 Tasks”的最终方案。
