# Conversation Shell — 任务清单

## 任务版本

| 日期 | 版本 | 说明 |
| --- | --- | --- |
| 2026-08-29 | v1 | 初始任务 |
| 2026-08-29 | v2 | 增加 runtime 展示与确认适配任务 |

## 项目信息

- 项目名: pi-monorepo
- 架构类型: npm workspace monorepo
- specs 路径: `specs/byz-conversational-agent/1.conversation-shell/`

## 任务列表

### 防护网与基准

- [x] T-001: 运行并记录 `packages/byz` 现有测试基线；确认 Fast、Prewalk、workflow 与 update 行为 ~15min
- [x] T-002: 为结构基准场景补充交互/文案映射测试：开始目标、普通完成、等待、待决、失败、详情与验收 ~30min

### 对话展示策略

- [x] T-003: [CHANGED v2] 新增纯函数 interaction policy，定义六类展示状态、一次性 progress 抑制、内部术语过滤与 runtime 适配契约 ~30min
- [x] T-004: [CHANGED v2] 在 `packages/coding-agent` 实现公开展示与确认适配 API，并以未注册适配器时行为不变的回归测试固定边界 ~1h
- [x] T-005: [CHANGED v2] 新增 conversation extension，注册默认欢迎、自然语言控制短语、按需详情切换，并连接 runtime 适配器 ~1h
- [x] T-006: [CHANGED v2] 在 BYZ CLI 组合 conversation extension 与现有 workflow/Fast/Prewalk extension；去除默认内部 banner ~30min

### 状态与确认体验

- [x] T-007: [CHANGED v2] 将普通结果、等待、待决、失败和详情输出接入 runtime 展示策略，并保证文字状态不依赖颜色 ~1h
- [x] T-008: [CHANGED v2] 实现自然语言确认/拒绝输入与可选快捷选择的 runtime 展示适配，不修改底层确认权限语义 ~1h
- [x] T-009: 在 80 列终端验证结构基准的状态层级、换行与待决动作可读性 ~30min

### 回归与交付验证

- [x] T-010: [CHANGED v2] 覆盖 runtime 适配器兼容性、无参数交互欢迎、低噪声 progress、内部术语隐藏、详情展开与确认提示的自动化测试 ~1h
- [x] T-011: 复跑 `packages/byz` 既有 Fast、Prewalk、workflow、update 与 smoke 测试，并记录回归结果 ~30min
- [x] T-012: 运行根 `npm run check`，修复本 feature 引入的全部错误、警告与信息 ~30min

## 依赖关系

- T-002 依赖 T-001。
- T-003 依赖 T-002。
- T-004 依赖 T-003。
- T-005 依赖 T-004。
- T-006 依赖 T-005。
- T-007、T-008 依赖 T-006。
- T-009、T-010 依赖 T-007、T-008。
- T-011 依赖 T-006。
- T-012 依赖 T-009、T-010、T-011。

## 风险点

- bundled runtime 的 extension API 可能没有足够的事件/渲染挂点；实现前必须检查类型和现有 extension 示例。
- 过滤既有通知时不得掩盖认证、信任、写入失败或安全错误。
- 终端宽度和主题差异可能改变结构基准的可读性；80 列是最低验证宽度。
