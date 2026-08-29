# Routing and Session Preferences — 技术设计

## 项目架构

- 架构类型: npm workspace monorepo；BYZ CLI 包装层。
- 涉及层: `packages/byz` conversation extension 与纯函数策略模块。
- 设计基准: 沿用 M1 结构级终端场景；不新增视觉基准。

## 模块设计

### 1. Route classifier

新增 `packages/byz/src/conversation/routing-policy.js`：

- 输入为当前用户 prompt 与当前会话偏好。
- 输出 `{ kind, instructions, missingInput, fallback }`，其中 kind 为 research、creative、bug-fix、feature、project-recovery 或 general。
- 使用可审计的本地规则，不调用模型、网络或文件系统。
- 仅把用户明确的 URL、缺陷描述、新功能/项目恢复提示作为分类信号；无法确定时归为 general。

### 2. Session preferences

由 conversation extension 保存内存态：

- `autonomy`: `balanced`、`direct`、`confirm-key-actions`、`fewer-questions`。
- `delivery`: `normal`、`three-directions`。
- `details`: 复用 M1 当前会话详情状态。

控制短语在 `before_agent_start` 解析；短语可与普通目标同轮出现。状态只存在 extension closure，session shutdown 与 reload 时自然丢弃。

### 3. Runtime integration

conversation extension 在 `before_agent_start`：

1. 解析控制短语并更新当前会话偏好。
2. 对清理后的目标文本执行纯函数分类。
3. 返回最小系统提示补充，规定本轮协作方式、缺失输入的诚实说明和可用降级路径。
4. 详情启用时，用用户可见通知展示类别和偏好；默认不通知。

不得调用 `setModel`、`setThinkingLevel`、`replaceByzWorkflowResources` 或资源发现接口。不得修改原 prompt、工具定义或现有权限确认语义。

## 接口契约

```js
classifyRequest(prompt, preferences) => {
  kind: "research" | "creative" | "bug-fix" | "feature" | "project-recovery" | "general",
  instructions: string,
  missingInput?: string,
  fallback?: string,
}
```

```js
parseSessionPreference(input) => {
  autonomy?: "direct" | "confirm-key-actions" | "fewer-questions",
  delivery?: "three-directions",
  details?: boolean,
}
```

## 安全考虑

- 输入只在进程内计算，不能写入 `.byz`、工作区、日志或环境变量。
- 系统提示只描述协作约束，不得注入用户秘密、路径、Cookie 或凭据。
- 路由不足以授权写入、外部发送、发布或支付；M1/M4 的确认边界保持有效。

## 技术决策

| 决策 | 选择 | 理由 |
| --- | --- | --- |
| 路由机制 | 纯函数规则分类 | 可预测、无额外模型调用、便于测试 |
| 路由执行 | 最小系统提示补充 | 不重写 runtime 或既有能力装载 |
| 偏好作用域 | 当前 extension 会话 | M3 前不引入持久化与数据生命周期 |
| 高级能力 | 不自动切换 | 避免未经用户同意改变成本、能力与控制边界 |
