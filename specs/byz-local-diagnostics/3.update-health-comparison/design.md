# Update Health Comparison — 技术设计

## 设计版本

| 日期 | 版本 | 说明 |
| --- | --- | --- |
| 2026-08-30 | v1 | 初始设计 |

## 项目架构

- 架构类型: Node.js npm workspace monorepo
- 涉及层: BYZ update 命令、本地诊断聚合、后续运行摘要
- 依赖 feature: `1.local-diagnostics-foundation`

## 功能模块设计

### 模块 1: Best-effort 更新基线

`packages/byz/src/update.js` 接收一个默认 no-op 的 diagnostics facade：

```text
captureUpdateBaseline(context): void
recordUpdateResult(result): void
```

两者均同步快速返回，只向 foundation recorder 投递固定事件或向 Worker 请求后台生成聚合基线；`handleByzUpdate()` 不 await 诊断结果。任何 facade 异常都由 facade 内部吞掉，不能进入更新 try/catch 或改变 `process.exitCode`。

基线请求在确定 plan 为 `update` 后、启动 npm 命令前发出。主流程不等待 Worker ack，因此基线允许缺失；后续比较必须把缺失基线判为 `insufficient_data`，不得用更新后数据反推或伪造更新前基线。`current`、`ahead`、参数错误和无法更新分支只记录固定 outcome，不创建可比较基线。

### 模块 2: 更新状态记录

更新记录保存在受管目录：

```text
~/.byz/diagnostics/updates/<update-id>/
├── baseline.json
└── result.json
```

`update-id` 是本地随机冲突避免值，不进入导出。记录只含：旧/新 BYZ 语义版本、运行时类别、OS 类别、运行模式类别、Provider 类别、诊断配置版本、聚合指标和固定结果枚举。

不记录 npm 命令、install prefix、stdout/stderr、异常消息或 registry payload。`runCommand()` reject 时，更新逻辑只调用不会抛出的 `recordUpdateResult({ outcome: "command_failed" })`，随后原样 `throw error`；不得包装、替换 rejection value 或修改既有 `process.exitCode`。

### 模块 3: 后续样本比较

更新成功后的下一版本正常运行会在 Worker 中检查 pending update。只有现有聚合数据已经满足样本阈值时才生成 comparison；否则立即返回，不设 timer、不轮询、不保持进程存活。

比较键：

```text
event + mode + tool_category + provider_category + runtime_major + os_category + diagnostics_schema
```

明确不含 model id、项目、session、用户、路径和时间精确到单次行为的标识。

默认两侧各至少 20 个同类样本。判断：

- 错误率绝对增加至少 5 个百分点：`observed_regression`；
- 错误率绝对降低至少 5 个百分点：`improved`；
- 主要耗时桶向更慢/更快移动：对应 regression/improved；
- 未达到阈值：`stable`；
- 样本不足：`insufficient_data`；
- 环境键不同：`not_comparable`。

结果始终附固定声明 `correlation_only: true`。

### 模块 4: 摘要与生命周期

`diagnostics summary` 展示最近更新比较的版本范围、两侧样本量、环境可比状态和固定结论，不显示 update-id 或源文件路径。

foundation retention 将 updates 目录纳入 30 天/100 MB 管理；`diagnostics clear` 删除其基线、结果和 comparison。

### 模块 5: 更新主流程隔离

测试通过依赖注入模拟 recorder 抛异常、队列满、Worker 不存在、目录只读和磁盘满。每种情况下必须断言：

- `planByzUpdate` 结果不变；
- npm command 对象和调用次数不变；
- stdout/stderr 的既有关键文本不变；
- `process.exitCode` 不变；
- 更新 Promise 的 resolve/reject identity 不被诊断包装替换。

## 接口契约

不新增或改变 `byz update [--force]` 参数。更新比较只通过 `byz diagnostics summary` 和 `clear` 暴露。

comparison DTO：

```json
{
  "schemaVersion": 1,
  "fromVersion": "0.1.10",
  "toVersion": "0.1.11",
  "metric": "tool_error_rate",
  "beforeSamples": 20,
  "afterSamples": 20,
  "comparability": "comparable",
  "outcome": "observed_regression",
  "correlationOnly": true
}
```

所有字符串除语义版本外均为封闭枚举。

## 数据模型

基线、结果和 comparison 使用独立版本化 DTO。旧 Schema 不参与比较但保留到 retention 清理；不能猜测迁移旧数据。

## 波及面

| 改动 | 直接调用方 | 可能受影响的存量功能 | 回归要求 |
| --- | --- | --- | --- |
| `packages/byz/src/update.js` 加 no-op facade 调用 | `byz update` | 包身份校验、不降级、registry 固定端点、npm 命令执行与退出码 | 全部 update.test.mjs 保持通过并新增故障注入 |
| diagnostics Worker 增加 update 数据 | 普通 BYZ 后续运行 | Worker 资源和 retention | 不保持进程存活；clear/容量测试覆盖 |
| summary 增加 comparison | diagnostics 用户 | 原摘要格式 | 无 comparison 时输出稳定，旧摘要测试保持通过 |

## 安全考虑

- 基线只含聚合指标，不含单次事件和高基数标识。
- 更新命令输出、异常消息、prefix 和 registry payload不进入诊断。
- comparison 不用于自动回滚、阻止启动或自动上报。
- 关闭诊断后 facade 为 no-op。

## 技术决策

| 决策 | 选项 | 理由 |
| --- | --- | --- |
| 更新集成 | 注入式 no-op facade | 可机械证明诊断异常不改变现有更新主流程 |
| 比较时机 | 后续普通运行，有样本即算 | 不等待、不轮询、不创建常驻服务 |
| 结论 | 固定趋势枚举 + correlation-only | 避免把相关变化误报为版本因果 |
| 样本阈值 | 两侧各 20 | 采用已确认默认，样本不足不输出百分比 |
