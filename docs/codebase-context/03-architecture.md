# 架构设计与模块关系

## 分层结构

```text
BYZ CLI/product wrapper (packages/byz)
    ↓ packages and selects workflow/runtime boundary
Pi CLI (packages/coding-agent/src/cli.ts)
    ↓ parses args/config and selects mode
Agent session runtime (packages/coding-agent/src/core)
    ↓ composes model, tools, prompts, session services
AI provider adapters (packages/ai/src/api)
    ↓ external model APIs
Protocol/client/server/session backend (packages/protocol, client, server, session-backends)
```

## 启动链路

- BYZ public command is declared in `packages/byz/package.json` as `byz -> dist/cli.js`.
- Pi public command is declared in `packages/coding-agent/package.json` as `pi -> dist/bundle/cli.js`.
- Coding-agent source entry points include `packages/coding-agent/src/cli.ts`, `main.ts`, `bun/cli.ts`, and `rpc-entry.ts`.
- Mode routing lives under `packages/coding-agent/src/modes/` with interactive, print, json-event, and rpc mode implementations.

## 路由表

| 路径/命令 | 模块 | 定义位置 |
| ---- | ---- | ---- |
| `pi` CLI | coding-agent bundled CLI | `packages/coding-agent/package.json` |
| `byz` CLI | BYZ product CLI | `packages/byz/package.json` |
| RPC mode | remote/session protocol path | `packages/coding-agent/src/modes/rpc/**` |
| Session server | listener/session orchestration | `packages/server/src/**` |

## 模块依赖关系

| 模块 | 依赖谁 | 被谁依赖 |
| ---- | ---- | ---- |
| `packages/byz` | built Pi baseline, workflow bundles | npm users invoking `byz` |
| `packages/coding-agent` | `ai`, `agent`, `client`, `protocol`, `tui` | CLI users and BYZ packaging |
| `packages/agent` | `ai`, `telemetry` | `coding-agent`, sqlite backend |
| `packages/ai` | provider SDKs, model data | agent runtime/provider calls |
| `packages/protocol` | typebox | client/server/coding-agent RPC |
| `packages/session-backends/sqlite-node` | `agent`, `ai` | session persistence consumers |
