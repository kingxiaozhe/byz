# 变更日志 — 2026-08-29

> base-commit: 1575b64d7bf48fc7544c4554ba59604e62391537

## Feature 1: conversation-shell

### 新增

- BYZ 默认交互壳提供目标优先欢迎语、低噪声等待提示、内部术语过滤、按需详情和自然语言确认。
- bundled runtime 暴露展示与确认适配接口，未注册适配器时保持原行为。
- BYZ CLI 组合 conversation、workflow、Fast 与 Prewalk extension；默认隐藏高级入口，用户请求详情后展示。

### 关键文件

- `packages/byz/src/conversation/interaction-policy.js` — 展示状态、progress 抑制、内部术语过滤与确认文本格式化。
- `packages/byz/src/conversation/conversation-extension.js` — 默认欢迎、详情切换、展示策略和确认 presenter 接入。
- `packages/byz/src/cli.js` — BYZ 交互模式 extension 组合入口。
- `packages/coding-agent/src/core/extensions/types.ts` — extension UI 展示和确认适配 API 类型。
- `packages/coding-agent/src/modes/interactive/interactive-mode.ts` — TUI runtime 展示与确认适配接入。
- `packages/byz/test/conversation.test.mjs` — 对话壳策略与 extension 自动化测试。

### 架构决策

- 展示策略只影响用户可见文本，不改变底层模型、工具、权限或确认执行结果。
- Fast、Prewalk、workflow 保留原能力，但默认首屏和普通输出不主动宣传。
- 颜色仅作辅助，状态必须有明确文字。

### 验证

- `npm --prefix packages/byz test` — 97 项通过。
- `node "$(git rev-parse --show-toplevel)/node_modules/vitest/dist/cli.js" --run packages/coding-agent/test/suite/regressions/5943-session-start-notify.test.ts` — 7 项通过。
- 80 列 tmux TTY 走查 — BYZ 交互界面启动并可提交 `展开细节`。
- `npm run check` — 通过。

## Feature 2: routing-preferences

### 新增

- BYZ 对当前轮请求执行本地纯函数分类：research、creative、bug-fix、feature、project-recovery、general。
- BYZ 在当前会话内识别 `直接做`、`少问一点`、`关键动作先问我`、`先给三个方向`、`展开细节` 等协作偏好。
- `before_agent_start` 注入最小协作提示；默认不展示类别和偏好，详情模式下才通知当前类别与偏好。
- 缺少输入或能力不足时提供未完成说明和可行降级路径。

### 关键文件

- `packages/byz/src/conversation/routing-policy.js` — 本地路由分类、偏好解析、会话内策略状态。
- `packages/byz/src/conversation/conversation-extension.js` — 接入路由策略、会话重置、详情展示与系统提示补充。
- `packages/byz/test/conversation.test.mjs` — 覆盖分类、偏好解析、重置、详情显示和回归行为。
- `packages/byz/CHANGELOG.md` — 记录 BYZ 包的 Unreleased 变更。

### 架构决策

- 路由为本地纯函数，不调用模型、网络或文件系统。
- 偏好仅保存在 extension closure 中，session start/shutdown 后重置，不写入 `.byz`、环境变量或工作区文件。
- 路由仅追加协作提示，不切换模型、thinking、workflow、skill 或资源状态。

### 验证

- `node --test packages/byz/test/conversation.test.mjs` — 通过。
- `npm --prefix packages/byz test` — 97 项通过。
- 80 列 tmux TTY 走查 — BYZ 交互界面启动并可提交 `展开细节`。
- `npm run check` — 通过。
