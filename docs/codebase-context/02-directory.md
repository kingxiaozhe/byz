# 目录结构

## 目录树（关键目录）

```text
packages/
├── ai/                         # provider adapters, model metadata, auth/API helpers
├── agent/                      # core agent runtime
├── coding-agent/               # pi CLI, tools, modes, config, prompts, session orchestration
├── tui/                        # terminal UI rendering primitives
├── protocol/                   # schemas, codec, framing
├── client/                     # protocol client
├── server/                     # session server/listener
├── session-backends/sqlite-node/# sqlite session backend
├── telemetry/                  # telemetry package
├── evals/                      # eval harness
└── byz/                        # BYZ CLI/product wrapper and workflow bundling
```

## 目录职责

| 目录 | 职责 | 典型文件 |
| ---- | ---- | ---- |
| `packages/coding-agent/src/core` | Agent session runtime, config, tools, prompts, model/runtime orchestration | `agent-session.ts`, `model-runtime.ts`, `tools/*.ts` |
| `packages/coding-agent/src/modes` | print/json/interactive/rpc modes | `interactive/interactive-mode.ts`, `rpc/rpc-mode.ts` |
| `packages/ai/src/api` | Provider-specific request/stream adapters | `openai-responses.ts`, `anthropic-messages.ts` |
| `packages/protocol/src` | Wire schemas and serialization | `schemas.ts`, `framing.ts` |
| `packages/server/src` | Local/remote session server | `server.ts`, `sessions.ts` |
| `packages/session-backends/sqlite-node/src/sqlite` | Durable sqlite storage | `repo.ts`, `storage/*.ts`, `migrations/001_initial.sql` |
| `packages/byz/src` | BYZ command/runtime layer | `cli` build target |
| `scripts` | Repo checks, release, model generation, packaging | `release.mjs`, `generate-coding-agent-shrinkwrap.mjs` |

## 文件清单（供增量扫描对比新增/删除）

| 文件/模式 | 所属轮次 |
| ---- | ---- |
| `package.json`, `packages/*/package.json`, `README.md`, `tsconfig*.json`, `biome.json` | 1 |
| `packages/*/src/**`, `packages/session-backends/*/src/**` | 2 |
| `packages/coding-agent/src/cli.ts`, `main.ts`, `modes/**`, `packages/byz/src/**` | 3 |
| `packages/ai/src/api/**`, `packages/protocol/src/**`, `packages/server/src/**`, `packages/client/src/**` | 4 |
| `**/types.ts`, `packages/protocol/src/schemas.ts`, `packages/ai/src/**/*.models.ts` | 5 |
| `packages/coding-agent/src/core/**`, `packages/tui/src/**` | 6 |
| `scripts/**`, config files, `packages/coding-agent/src/utils/**` | 7 |
