# Routing and Session Preferences — 任务清单

## 项目信息

- 项目名: pi-monorepo
- 架构类型: npm workspace monorepo
- specs 路径: `specs/byz-conversational-agent/2.routing-preferences/`

## 任务列表

### 路由与偏好策略

- [x] T-001: 为常见任务形态与控制短语添加纯函数路由/偏好解析测试 ~30min
- [x] T-002: 新增 routing policy，分类常见任务、生成协作约束并给出缺失输入降级路径 ~1h
- [x] T-003: 扩展 conversation extension，保存当前会话偏好并在 `before_agent_start` 注入最小协作提示 ~1h

### 展示与兼容性

- [x] T-004: 在详情模式展示当前类别与偏好，默认隐藏；确认路由不改变模型、workflow、skill 或持久化状态 ~30min
- [x] T-005: 覆盖分类、偏好重置、失败降级、详情可见性与 M1/Fast/Prewalk/workflow 回归 ~1h
- [x] T-006: 运行 80 列 TTY 走查与根 `npm run check`，修复本 feature 引入的全部错误、警告与信息 ~30min

## 依赖关系

- T-002 依赖 T-001。
- T-003 依赖 T-002。
- T-004 依赖 T-003。
- T-005 依赖 T-004。
- T-006 依赖 T-005。

## 风险点

- `before_agent_start` 只能补充协作约束，不能保证模型绝对服从；测试必须验证注入内容和不改变 runtime 状态，而非声称模型行为确定。
- 控制短语与实际任务混合时不得丢失用户目标。
