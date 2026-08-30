# Local Diagnostics Foundation — 任务清单

## 任务版本

| 日期 | 版本 | 说明 |
| --- | --- | --- |
| 2026-08-30 | v1 | 初始任务 |

## 项目信息

- 项目名: pi-monorepo
- 架构类型: Node.js npm workspace monorepo
- specs 路径: `specs/byz-local-diagnostics/1.local-diagnostics-foundation/`

## 任务列表

### 防护网基线

- [x] T-001: 运行并记录 `packages/byz` 现有测试、CLI smoke 和禁用诊断启动性能基线，确认当前 workflow/update/Fast/普通参数转发行为 ~30min

### 隐私 Schema 与配置

- [x] T-002: 在 `packages/byz/src/diagnostics/` 实现低基数事件 Schema、运行时白名单验证、tool/provider/error-site 固定映射和敏感字段拒绝测试 ~1h
- [x] T-003: 实现诊断配置、独立首次告知 marker、enable/disable、临时 record 到期/停止和安全原子配置写，并覆盖损坏配置与多进程更新测试 ~1h

### 非阻塞记录与存储

- [x] T-004: 实现 no-op recorder、credit-based 有界投递、Worker 生命周期、ack/drop bucket 和绝不抛错的 facade，并通过队列满/Worker 启动失败/退出故障注入 ~1.5h
- [x] T-005: 实现每进程 JSONL 分片、私有权限、generation clear 协议、30天/100MB轮转、符号链接防护和损坏尾行容错，并覆盖并发与文件系统故障 ~2h

### Runtime 事件接入

- [x] T-006: 实现 diagnostics extension，只投影 session/agent/provider/tool 的允许字段，并修改 BYZ CLI 与 build 脚本在所有 runtime 模式注入/复制该 extension ~1.5h

### 本地命令与分析

- [x] T-007: 实现 `status`、`doctor` 和 `clear --confirm`，覆盖退出码、只读检查、generation 清除和部分失败报告 ~1h
- [x] T-008: 实现 `summary [--since]` 的流式聚合、数据不足状态和 CM 全局镜像固定字段投影，禁止输出 detail/path/项目字段 ~1.5h

### 回归、性能与文档

- [x] T-009: 增加端到端隐私、无网络、各运行模式、进程不保活和主流程非干扰回归；复跑 T-001 基线并验证启动 p95 与高频记录 p95 指标 ~2h
- [x] T-010: 更新 `packages/byz/README.md` 和 `packages/byz/CHANGELOG.md` 的命令、隐私、保留与非干扰说明 ~30min

## 依赖关系

- T-002、T-003 依赖 T-001。
- T-004 依赖 T-002、T-003。
- T-005 依赖 T-004。
- T-006 依赖 T-002、T-004、T-005。
- T-007 依赖 T-003、T-005。
- T-008 依赖 T-002、T-005。
- T-009 依赖 T-006、T-007、T-008。
- T-010 依赖 T-007、T-008、T-009。

## AC 映射

| 任务 | AC |
| --- | --- |
| T-002 | AC-003, AC-004, AC-005 |
| T-003 | AC-001, AC-002, AC-006, AC-018 |
| T-004 | AC-011, AC-012, AC-014 |
| T-005 | AC-007, AC-009, AC-010, AC-013 |
| T-006 | AC-001, AC-004, AC-005, AC-015, AC-017 |
| T-007 | AC-002, AC-008, AC-009, AC-018 |
| T-008 | AC-007, AC-017 |
| T-009 | AC-011, AC-012, AC-013, AC-014, AC-015, AC-016 |

## 风险点

- ExtensionRunner 会 await handler；handler 必须同步快速返回，禁止返回记录 Promise。
- `postMessage` 自身不提供有界队列，必须依赖 credit 上限而非假设 Worker 会及时消费。
- clear 与活跃进程通过 generation 隔离；不得引入共享阻塞锁追求零丢失。
- 现有 agent telemetry 含高基数标识，禁止直接连接持久化 writer。
