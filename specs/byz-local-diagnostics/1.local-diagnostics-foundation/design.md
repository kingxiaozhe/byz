# Local Diagnostics Foundation — 技术设计

## 设计版本

| 日期 | 版本 | 说明 |
| --- | --- | --- |
| 2026-08-30 | v1 | 初始设计 |

## 项目架构

- 架构类型: Node.js npm workspace monorepo
- 涉及层: `packages/byz` CLI 路由、BYZ 内置 extension、后台 Worker、本地文件存储、测试与文档
- 不修改层: Provider adapters、会话 JSONL、用户项目文件、CM authoritative project logs

## 设计目标

运行期只做固定小对象构造、白名单验证和有界 `postMessage`。文件 I/O、轮转和索引维护全部在未被主流程等待的 Worker 中完成。任何诊断错误都退化为 no-op；不能通过异常、Promise 等待、共享锁或退出 flush 影响主流程。

## 功能模块设计

### 模块 1: CLI 诊断命令路由

在 `packages/byz/src/diagnostics/commands.js` 实现 BYZ 自有命令解析，在 Pi runtime 启动前处理：

```text
byz diagnostics status
byz diagnostics enable
byz diagnostics disable
byz diagnostics record --for 30m
byz diagnostics record --stop
byz diagnostics summary [--since 24h]
byz diagnostics doctor
byz diagnostics clear --confirm
```

`packages/byz/src/cli.js` 在 workflow/update/runtime 分流前调用该处理器。诊断命令不进入 Pi 参数解析。普通 BYZ 命令只调用轻量 recorder API，不等待 Worker。

配置位于 `~/.byz/diagnostics/config.json`，可由 `BYZ_DIAGNOSTICS_HOME` 显式覆盖以支持测试和受控部署。配置字段固定为：

```json
{
  "schemaVersion": 1,
  "enabled": true,
  "noticeShown": false,
  "retentionDays": 30,
  "maxBytes": 104857600,
  "detailUntil": null,
  "generation": 1
}
```

命令写配置时使用同目录临时文件、私有权限和原子 rename。普通运行读取失败时直接使用安全默认值；不得修复损坏配置或阻止启动。

### 模块 2: 诊断 Schema 与隐私验证

`packages/byz/src/diagnostics/schema.js` 定义 BYZ 自有低基数事件词汇，并沿用 `TelemetryContext` 的 span/status/event 概念。持久化边界执行运行时验证，不依赖 TypeScript 推断或事后正则脱敏。

允许的事件：

| 事件 | 允许字段 |
| --- | --- |
| `byz.app.run` | `version`, `runtime`, `mode`, `outcome`, `duration_bucket` |
| `byz.agent.run` | `mode`, `outcome`, `stop_reason`, `duration_bucket` |
| `byz.model.request` | `provider_category`, `outcome`, `http_status_class`, `stop_reason`, `duration_bucket` |
| `byz.tool.execution` | `tool`, `outcome`, `duration_bucket` |
| `byz.diagnostics.degrade` | `component`, `reason`, `dropped_bucket` |

所有 string 字段必须有封闭枚举；版本必须通过语义版本/运行时版本专用解析器；计数必须为有限非负整数。持久化 envelope 只包含：

```json
{
  "schemaVersion": 1,
  "at": "2026-08-30T00:00:00.000Z",
  "event": "byz.tool.execution",
  "attributes": {
    "tool": "read",
    "outcome": "ok",
    "duration_bucket": "10ms-100ms"
  }
}
```

禁止通用 `Record<string, unknown>` 直接进入 writer。validator 返回 accepted/rejected，不抛异常，不回显被拒值。运行时值在排队前完成低基数映射：内置工具映射到固定工具枚举，所有扩展工具统一为 `custom`；已知 Provider 映射到维护的类别，未知值统一为 `other`；错误位置只能映射到 BYZ 自有模块的固定 `error_site` 枚举。原始 tool/provider/error 字符串不得进入 attributes。

现有 `AI_TELEMETRY_SCHEMA` 和 `HARNESS_TELEMETRY_SCHEMA` 含 session id、operation id、model id、response id 等高基数字段，因此不能直接连接到持久化 adapter。BYZ 只使用自己的安全投影 Schema。

### 模块 3: 非阻塞 Recorder 与有界队列

`packages/byz/src/diagnostics/recorder.js` 暴露：

```text
createDiagnosticsRecorder(options) -> {
  record(eventName, attributes): void
  createExtension(): ExtensionFactory
  close(): void
}
```

行为：

1. 禁用或初始化失败时返回 frozen no-op recorder；
2. `record()` 同步验证固定小对象；
3. 主线程维护固定 `maxInFlight` credit，默认 256；
4. 有 credit 时 `worker.postMessage()` 并立即返回；
5. 无 credit、structured clone 失败或 Worker 不可用时直接丢弃；
6. Worker ack 后归还 credit；有机会时只发送分桶后的 drop summary；
7. Worker 使用 `unref()`，`close()` 只解除监听并终止，不 flush、不 await；
8. recorder 的所有公开方法用最外层 try/catch 保证不抛异常。

不使用共享文件锁。每个进程写独立分片：

```text
~/.byz/diagnostics/
├── config.json
├── notice-shown
├── events/<generation>/YYYY-MM-DD/<timestamp>-<pid>-<random>.jsonl
├── state/<generation>/<pid>-<random>.json
├── summaries/
└── exports/
```

随机值由本地随机源生成，只用于避免分片名冲突，不写入事件或导出摘要。

### 模块 4: 后台 Worker 与存储轮转

`packages/byz/src/diagnostics/writer-worker.js` 负责：

- 创建用户私有目录 `0700` 和文件 `0600`；
- 使用异步 append 写当前进程分片；
- 单条事件一次写入，尾行损坏由读取器容忍；
- 定期而非每条事件扫描容量；
- 仅删除受管目录内、通过文件名和 `lstat` 验证的普通分片；
- 先按 30 天，再按 100 MB 删除最旧分片；
- 不跟随符号链接；
- 写入/轮转失败后打开进程内 circuit breaker，停止 I/O 并 ack/drop 后续事件；
- 每批写入前检查当前 generation；与启动 generation 不一致时永久停止旧 Worker 写入；
- 不把错误消息或路径回传主线程，只返回固定 reason 枚举。

`diagnostics clear` 先原子增加 `config.generation`，再删除旧 generation 的事件、state、summary、update 和 export 数据。活跃旧 Worker 即使持有已打开文件描述符，也不能重新创建新代目录；代际变化后停止。clear 保留用户的 enabled/retention 偏好，重置受管诊断数据。配置更新只由显式 diagnostics 命令执行，Worker 不回写整个 config。

多进程不共享写文件、锁或内存队列。summary/doctor 读取各分片快照，遇到并发追加的末尾不完整行时忽略该尾行。

### 模块 5: BYZ 运行事件 Extension

`packages/byz/src/diagnostics/diagnostics-extension.js` 通过现有 extension events 观察运行行为：

- `session_start` / `session_shutdown`: app/session 生命周期类别；
- `agent_start` / `agent_end` / `agent_settled`: agent 耗时与固定停止类别；
- `before_provider_request` / `after_provider_response`: 模型请求耗时和 HTTP 状态类别；处理器不得检查 payload、headers 或 response body；
- `tool_execution_start` / `tool_execution_end`: 只读取 `toolName` 和 `isError`，不得读取 `args`、`result` 或 `toolCallId`；
- `turn_end`: 只读取消息 role 和 normalized stop reason，不读取 content、error message 或 usage id。

事件 handler 必须是同步快速返回；调用 `record()` 后不 await。请求开始时间保存在进程内 FIFO，无法配对时记录固定 `unpaired` 类别或丢弃，不读取敏感对象补偿。

`packages/byz/src/cli.js` 在所有进入 Pi runtime 的分支通过 `main(..., { extensionFactories: [...] })` 注入诊断 extension；交互 workflow 组合逻辑继续保持原有 BYZ workflow extension 独立边界。

### 模块 6: 本地摘要与 CM 安全投影

`packages/byz/src/diagnostics/reader.js` 流式读取受管分片，仅接受当前 Schema 和白名单字段。输出聚合计数、成功率、耗时桶、错误类别和样本量，不输出原始行。

CM 工作流不复制到 BYZ 日志。`summary` 可以只读 `${CM_WORKFLOW_LOG_HOME:-~/.cm-workflow/logs}` 的本地全局镜像并仅投影以下字段：`workflow`, `event`, `phase`, `runtime`, `outcome`。明确禁止读取/输出 `detail`, `project`, `project_path`, `specs_path` 和未知字段。CM 日志不存在或损坏时显示该来源不可用，不影响 BYZ 摘要。

### 模块 7: 首次告知

首次告知只通过交互 session 的 `ctx.ui.notify()` 显示一次，内容说明：本地开启、不上传、不记录 Prompt/代码、可用 `byz diagnostics disable` 关闭。告知状态使用独立的私有 `notice-shown` marker，不由 Worker 重写 config；marker 创建失败可以导致后续再次告知，但不得阻止 session。

非交互、`--help`、`--version`、print、JSON event 和 RPC stdout 不显示告知。

## 接口契约

### CLI 退出码

| 状态 | 退出码 |
| --- | --- |
| 命令成功 | 0 |
| 参数/确认错误 | 1 |
| 诊断存储不可用或部分操作失败 | 2 |

普通 BYZ 主流程的退出码永远不由 recorder 修改。

### Duration bucket

`<10ms`, `10ms-100ms`, `100ms-1s`, `1s-5s`, `5s-30s`, `>=30s`, `unknown`。

### Error/degrade category

仅允许维护在 Schema 中的固定枚举，例如 `disabled`, `queue_full`, `worker_start`, `worker_exit`, `permission`, `disk_full`, `invalid_record`, `corrupt_file`, `schema_mismatch`, `unknown`。错误定位使用固定 `error_site` 枚举；不得持久化 `Error.message`、原始 stack、绝对路径、行号或第三方帧。

## 数据模型

配置、事件 envelope 和聚合摘要均带独立 `schemaVersion: 1`。摘要保存时只包含分桶计数和生成时间范围，不包含源文件名或绝对路径。

## 波及面

| 改动 | 直接调用方 | 可能受影响的存量功能 | 回归要求 |
| --- | --- | --- | --- |
| `packages/byz/src/cli.js` 增加 diagnostics 分流和 extension 注入 | `byz` 所有命令 | workflow、update、Fast、普通 Pi 参数转发 | 现有 BYZ smoke/update/workflow/Fast 测试全部保持通过 |
| `packages/byz/scripts/build.mjs` 复制 diagnostics 目录 | BYZ 发布构建 | npm 包内容和外部安装 | smoke 验证 dist 文件存在且命令可启动 |
| 新增诊断 extension | coding-agent ExtensionRunner | agent/tool/provider 事件延迟与异常隔离 | 故障注入、性能和各模式测试 |
| 读取 CM 全局镜像 | `diagnostics summary` | 无；只读独立来源 | 禁止字段投影测试，不修改 CM 文件 |
| README/CHANGELOG | 用户文档 | 无运行时影响 | 文档与命令帮助一致 |

## 安全考虑

- 白名单优先于脱敏；未知字段失败关闭。
- Worker 只接收已验证的固定小对象。
- 禁止把现有高基数 agent telemetry 直接落盘。
- 受管目录操作使用 `lstat`/realpath 边界检查，不跟随符号链接。
- 普通运行不发起诊断网络请求。
- 诊断失败只用固定枚举暴露状态，不回显敏感错误。

## 技术决策

| 决策 | 选项 | 理由 |
| --- | --- | --- |
| 运行期 I/O | Worker thread + 每进程分片 | 主线程不等待文件 I/O，多进程无共享锁 |
| 队列 | credit-based 有界 in-flight | Node Worker 消息队列本身无界，必须在主线程限制 |
| Schema | BYZ 低基数安全投影 | 现有 agent Schema 含不适合持久化的高基数标识 |
| 存储 | JSONL 分片 | 可恢复、易聚合、尾行损坏可隔离 |
| CM 集成 | 只读安全投影，不复制日志 | 保持 CM 项目日志权威性和隐私边界 |
| 远程能力 | 不实现 | 用户未授权，且 BYZ 当前显式关闭 Pi telemetry |
| 第三方依赖 | 不新增 | Node 标准库足以完成 Worker、JSONL 和本地分析 |
