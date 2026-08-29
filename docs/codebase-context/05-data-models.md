# 数据模型与类型

## 实体

| 名称/区域 | 字段摘要 | 定义位置 | 主要使用方 |
| ---- | ---- | ---- | ---- |
| Protocol schemas | RPC/session wire structures | `packages/protocol/src/schemas.ts` | client/server/coding-agent RPC |
| SQLite session records | sessions, entries, branches, facts, stats, leases | `packages/session-backends/sqlite-node/src/sqlite/types.ts`, `storage/*.ts` | sqlite repository/search backend |
| Agent messages/session state | conversation messages, runtime state, session data | `packages/coding-agent/src/core/messages.ts`, `agent-session*.ts` | coding-agent runtime |
| Model/provider metadata | model definitions, provider catalogs, generated model data | `packages/ai/src/**`, `packages/ai/src/models.generated.ts` | model resolver/runtime |
| TUI rendering data | terminal render primitives and component state | `packages/tui/src/**` | interactive mode |

## 枚举

Project uses TypeScript union/types in many modules. Because `erasableSyntaxOnly` is enabled, new code must avoid TS `enum` in checked source paths.

## DTO / 请求响应类型

| 名称 | 用于接口 | 定义位置 |
| ---- | ---- | ---- |
| Provider request/response transforms | External model provider APIs | `packages/ai/src/api/*` |
| RPC mode types | Coding-agent RPC mode messages | `packages/coding-agent/src/modes/rpc/rpc-types.ts` |
| Server types | Session server internals | `packages/server/src/types.ts` |
| SQLite types | Durable session storage | `packages/session-backends/sqlite-node/src/sqlite/types.ts` |
