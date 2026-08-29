# Conversation Shell — 技术设计

## 设计版本

| 日期 | 版本 | 说明 |
| --- | --- | --- |
| 2026-08-29 | v1 | 初始设计 |
| 2026-08-29 | v2 | 增加 runtime 展示与确认适配边界 |

## 项目架构

- 架构类型: npm workspace monorepo；BYZ CLI 包装层。
- 涉及层: `packages/byz` CLI 与 extension 注册；bundled runtime 的公开交互扩展 API。
- 设计基准: 结构级。页面/场景、信息层级、状态语义和自然语言优先的选择流程必须一致；真实 TUI 可按终端能力重新排版。

## 波及面

- `packages/byz/src/cli.js`：当前直接组合 workflow、Fast 与 Prewalk extension，并将 Fast 状态主动输出到 stderr；需成为 conversation-shell 的唯一注册入口。
- `packages/byz/src/fast-session.js`：保留 `/fast` 行为，状态文案经展示策略过滤，不能改变模型/思考等级切换语义。
- `packages/byz/src/prewalk.js`：保留 `/prewalk` 行为，状态文案经展示策略过滤，不能改变 trusted-project 或内建写工具校验。
- `packages/byz/src/workflow-switch.js`：保留 `/workflow` 行为，默认帮助与普通对话不得主动提及 workflow。
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

### 4. CLI composition

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

自然语言控制初始覆盖：`展开细节`、`少问一点`、`关键动作先问我`、`直接做`。M1 只在当前会话生效；持久化属于 M2/M3。

## 安全考虑

- 默认展示层不得转发凭据、Cookie、Authorization header、模型请求内容或绝对路径。
- 确认提示不授予新权限；真实写入、外部发送与发布仍依赖底层已有权限和信任边界。
- 不新增依赖、网络调用或存储。

## 技术决策

| 决策 | 选择 | 理由 |
| --- | --- | --- |
| 首期范围 | runtime 展示适配器 + BYZ 策略层，不重写执行引擎 | 展示与确认必须有稳定公开挂点，仍保护模型、工具与权限语义 |
| 现有高级能力 | 保留但默认隐藏 | 不破坏已验证功能，符合“BYZ 是唯一用户品牌” |
| 原型基准 | 结构级 | 保证交互语义，同时适配真实终端宽度和主题 |
| 偏好持久化 | 延后 | 避免 M1 提前引入记忆与数据生命周期复杂度 |
