# Conversation Shell — 技术设计

## 设计版本

| 日期 | 版本 | 说明 |
| --- | --- | --- |
| 2026-08-29 | v1 | 初始设计 |
| 2026-08-29 | v2 | 增加 runtime 展示与确认适配边界 |
| 2026-08-30 | v3 | 增加 turn 内阶段计时、确认等待分离与耗时汇总 |
| 2026-08-30 | v4 | 增加 Footer 有效 Thinking 等级和事件驱动热更新 |

## 项目架构

- 架构类型: npm workspace monorepo；BYZ CLI 包装层。
- 涉及层: `packages/byz` CLI 与 extension 注册；bundled runtime 的公开交互扩展 API。
- 设计基准: 结构级。页面/场景、信息层级、状态语义和自然语言优先的选择流程必须一致；真实 TUI 可按终端能力重新排版。

## 波及面

- `packages/byz/src/cli.js`：当前直接组合 workflow、Fast 与 Prewalk extension，并将 Fast 状态主动输出到 stderr；需成为 conversation-shell 的唯一注册入口。
- `packages/byz/src/fast-session.js`：保留 `/fast` 行为，状态文案经展示策略过滤，不能改变模型/思考等级切换语义。
- `packages/byz/src/prewalk.js`：保留 `/prewalk` 行为，状态文案经展示策略过滤，不能改变 trusted-project 或内建写工具校验。
- `packages/byz/src/workflow-switch.js`：保留 `/workflow` 行为，默认帮助与普通对话不得主动提及 workflow。
- `packages/byz/test/conversation.test.mjs`：补充单调计时、阶段切换、确认等待、结束清理和双语格式测试。
- `packages/byz/test/*.test.mjs`：既有 Fast、Prewalk、workflow 与 smoke 回归必须保持。

## 模块设计

### 1. Conversation policy

新增 `packages/byz/src/conversation/interaction-policy.js`，作为纯函数策略层：

- 将输出分类为 `result`、`progress`、`decision`、`failure`、`detail`、`advanced-control`。
- `progress` 对同一 run 只允许一次用户可见等待提示。
- 默认策略丢弃或降级内部能力名称、工具名、模型名、token、workflow 名称和步骤序号。
- `detail` 或明确高级控制请求才允许显示被抑制内容。

### 2. Runtime presentation adapter

在 `packages/coding-agent` 的公开 extension UI API 增加仅展示层适配器：

- runtime 在写入用户可见结果、进展、失败、详情或确认提示前调用适配器；适配器可以保留、替换或抑制展示文本，并将自然语言确认映射到既有确认选项。
- 适配器不得访问或修改模型请求、工具入参、认证状态、权限判定和确认动作的最终执行结果。
- 未注册适配器时，runtime 行为保持不变；BYZ 是首个消费者。
- 适配器输入不得包含凭据、Cookie、Authorization header 或绝对路径。

### 3. Conversation extension

新增 `packages/byz/src/conversation/conversation-extension.js`：

- 注册欢迎/会话生命周期、用户自然语言控制短语和展示策略。
- 将策略层输出通过 runtime UI API 发送到终端。
- 不替代模型、工具、工作流或现有 extension 的业务行为；只决定什么对用户可见。
- 不能硬编码键名；快捷键继续由现有可配置 keybindings 提供。

### 4. Turn timing `[v3 新增]`

在 `packages/byz/src/conversation/conversation-extension.js` 内增加 turn-scoped 计时状态；如实现需要独立纯函数，可拆到同目录的 `turn-timing.js`，但不得引入运行时依赖。

- 使用 `performance.now()`，不使用系统墙钟，避免系统时间调整造成倒退或跳变。
- 固定阶段 ID：`goal`、`inspect`、`modify`、`command`、`recover`、`reply`、`other`；显示标签继续从中英文文案表解析，不把工具参数、Prompt 或自由文本作为阶段名。
- 状态保存当前阶段、当前 active segment 起点、等待确认起点、各阶段累计毫秒数、累计执行毫秒数、累计等待毫秒数和首次出现顺序。
- `transition(stageId)` 先结算上一 active segment，再切换阶段；重复进入同名阶段时累加到同一阶段。
- `pauseForConfirmation()` 结算当前 active segment并开始等待；`resumeAfterConfirmation()` 结算等待并恢复原阶段的新 active segment。confirmation presenter 的 `input` 和 fallback `confirm()` 必须整体包在 `try/finally` 内，异常或取消也能恢复/收口状态。
- `snapshot()` 只计算内存中的衍生值；`finish()` 幂等结算并冻结结果。状态不写入 session、诊断文件或模型上下文。

### 5. Progress rendering and lifecycle `[v3 新增]`

- `agent_start` 以 `goal` 阶段启动计时，并创建唯一的 1 秒刷新 interval；初始 working message 立即显示阶段与 `0分00秒`。
- 原有 8 秒完整进度卡延迟保持，但延迟前的简短 working message 也显示实时耗时；卡片可见后，每次 tick 只更新同一个 working message，不追加输出行。
- 工具开始、工具结束、assistant message update 分别通过固定映射触发阶段切换；同一阶段事件不重置计时。
- confirmation presenter 在全部用户决策等待期间暂停 active 计时，并在卡片中显示累计“等待确认”。
- `agent_end` 调用 `finish()`、停止 timeout/interval、清空 working message，并用一条低噪声通知显示按首次出现顺序排列的阶段耗时、执行耗时、等待确认和总历时。
- `session_shutdown` 必须停止全部 timer 并幂等结束，不在已销毁 UI 上继续渲染。非交互路径不会创建 conversation extension 的 turn timer。
- 格式按整秒向下取整：中文 `3分07秒`，英文 `3m 07s`。刷新频率固定为 1000ms；测试通过注入单调 `now` 和 scheduler 推进，不等待真实分钟。

### 6. Footer Thinking status `[v4 新增]`

- Conversation extension 在 `session_start` 从 `ctx.thinkingLevel` 读取当前实际生效等级，并在 Footer 右侧模型信息旁显示 `thinking <level>`。
- 监听 `thinking_level_select`，只消费固定等级枚举并更新内存状态；调用 Footer 组件的 `invalidate()` 请求 TUI 重绘，不修改模型或 Thinking 设置。
- 模型选择、Shift+Tab、`/thinking`、Fast 等现有路径继续负责真实状态变更；Footer 只是通知型消费者。
- 80 列及更窄终端将模型与 Thinking 组成高优先级右侧区域，先截断左侧项目、分支和统计；极窄宽度仍沿用现有安全截断。
- 非交互模式不创建 Footer，不新增存储、网络请求或模型调用。

### 7. CLI composition

在 `cli.js` 组合 conversation extension、workflow extension、Fast controller 和 Prewalk extension。

- 无参数交互启动优先显示 BYZ 欢迎语。
- 非交互、`update`、workflow 管理、帮助与版本命令继续走当前分支。
- 仅移除默认 Fast banner 等主动内部暴露；不移除命令或环境变量。

## 交互契约

| 状态 | 默认输出 | 用户动作 |
| --- | --- | --- |
| result | 自然回应 + 核心结果 + 可选下一步 | 继续自然语言输入 |
| progress | 一次简短等待说明 | 无需动作 |
| decision | 影响 + 推荐 + 替代项 + 拒绝结果 | 自然语言或快捷选择 |
| failure | 影响 + 已处理 + 是否需要决定 | 继续、修正或取消 |
| detail | 原始证据或高级控制 | 仅明确请求后进入 |
| timing | 当前阶段 + 阶段已用时间；完成后为阶段明细 + 执行/等待/总历时 | 只读，无需动作 |

自然语言控制初始覆盖：`展开细节`、`少问一点`、`关键动作先问我`、`直接做`。M1 只在当前会话生效；持久化属于 M2/M3。

## 安全考虑

- 默认展示层不得转发凭据、Cookie、Authorization header、模型请求内容或绝对路径。
- 确认提示不授予新权限；真实写入、外部发送与发布仍依赖底层已有权限和信任边界。
- 不新增依赖、网络调用或存储。
- 计时阶段只能来自固定 ID 和本地化标签，不能把 Prompt、路径、命令、工具参数或错误文本写入耗时摘要。

## 技术决策

| 决策 | 选择 | 理由 |
| --- | --- | --- |
| 首期范围 | runtime 展示适配器 + BYZ 策略层，不重写执行引擎 | 展示与确认必须有稳定公开挂点，仍保护模型、工具与权限语义 |
| 现有高级能力 | 保留但默认隐藏 | 不破坏已验证功能，符合“BYZ 是唯一用户品牌” |
| 原型基准 | 结构级 | 保证交互语义，同时适配真实终端宽度和主题 |
| 偏好持久化 | 延后 | 避免 M1 提前引入记忆与数据生命周期复杂度 |
| 计时时钟 | `performance.now()` | 单调且不受系统时间调整影响 |
| 等待口径 | 用户确认单独累计，不计入阶段执行耗时 | 区分 Agent 实际处理与人工等待 |
| 刷新方式 | 单一 1 秒 interval 更新现有 working message | 实时可见且不刷屏、不按内部事件高频重绘 |
| 完成展示 | 一条阶段明细通知，不写入模型回复 | 用户能复盘耗时，同时不修改模型内容 |
| Footer Thinking | 读取 effective level 并监听 `thinking_level_select` | 与模型能力限制、Fast 和用户热切换后的真实状态保持一致 |
