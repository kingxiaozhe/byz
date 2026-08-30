# 变更日志 — 2026-08-30

> base-commit: 1377a1135dae82b57ff569935898c1523d9a680f

## Feature 1: Local Diagnostics Foundation

### 新增

- 默认开启的本地结构化诊断，采用严格字段白名单、有界非阻塞队列、Worker 分片写入、generation 清除协议和跨目录保留策略。
- `status`、`summary`、`doctor`、`enable`、`disable`、临时详细记录和确认式清除命令。
- 一次性隐私提示、三种非交互模式隔离及启动性能预算验证。

### 关键文件

- `packages/byz/src/diagnostics/schema.js` — 封闭事件 Schema 与固定枚举映射。
- `packages/byz/src/diagnostics/recorder.js` — 有界、best-effort Worker 记录器。
- `packages/byz/src/diagnostics/writer-worker.js` — 私有 JSONL 分片、串行消息和故障降级。
- `packages/byz/src/diagnostics/commands.js` — 本地诊断命令路由。

### 架构决策

- 日志允许丢失，主流程不得因日志受损。
- Worker 监听器安装后必须再次 `unref()`，避免空闲诊断阻止命令退出。

## Feature 2: Safe Diagnostics Export

### 新增

- 用户预览并明确确认后生成的 aggregate-only 本地支持包。
- 固定 manifest、summary、privacy-report 三文件结构，私有权限和 symlink/目录 identity 防护。
- malformed/incomplete 数据 fail-closed，不自动上传、不自动进入模型上下文。

### 关键文件

- `packages/byz/src/diagnostics/export.js` — 安全预览、导出和原子落盘。
- `packages/byz/src/diagnostics/retention.js` — events/state/summaries/updates/exports 统一容量与时间保留。

### 架构决策

- 导出只消费通过持久化白名单复核的事件，并且只输出聚合数据。

## Feature 3: Update Health Comparison

### 新增

- BYZ 更新前基线、更新结果记录和更新后样本分区。
- 按 event、mode、tool、provider 系列进行同环境比较，样本不足或环境变化时拒绝趋势判断。
- 只报告相关性趋势，不自动回滚、不上传数据、不改变原更新异常。

### 关键文件

- `packages/byz/src/diagnostics/update-health.js` — 更新快照和系列化健康比较。
- `packages/byz/src/diagnostics/update-integration.js` — best-effort 更新生命周期集成。
- `packages/byz/src/update.js` — BYZ 更新入口接线。

### 架构决策

- 每个可比系列前后至少各 20 个样本；runtime/OS identity 不一致时不可比较。
- 更新失败必须原样抛出，诊断故障不能替换业务异常。
