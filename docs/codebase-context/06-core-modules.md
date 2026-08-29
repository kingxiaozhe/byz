# 核心模块

## 公共组件

This is not a browser component application. Terminal UI primitives live in `packages/tui/src/**`; interactive mode integration lives in `packages/coding-agent/src/modes/interactive/**`.

## 业务组件

| 组件/模块 | 职责 | 定义位置 | 所属业务 |
| ---- | ---- | ---- | ---- |
| CLI args/auth/config | Parse startup args, auth commands, config selection | `packages/coding-agent/src/cli/**` | CLI startup |
| Agent session runtime | Compose model runtime, tools, prompts, services, event bus | `packages/coding-agent/src/core/agent-session*.ts` | Agent loop |
| Tools | read/write/edit/bash/grep/find wrappers and mutation handling | `packages/coding-agent/src/core/tools/**` | Tool execution |
| Modes | interactive, print, json-event, rpc | `packages/coding-agent/src/modes/**` | User/runtime interface |
| BYZ workflow layer | workflow selection, updates, release contract | `packages/byz/src/**`, `packages/byz/scripts/**` | BYZ product |

## Hooks

本项目未发现 React/Vue hooks 目录。Terminal/agent lifecycle hooks are implemented as runtime services and extension hooks under `packages/coding-agent/src/core/extensions/**` and `packages/coding-agent/src/core/hooks/**` when present.

## Store

| 模块 | state 摘要 | 主要 actions | 定义位置 |
| ---- | ---- | ---- | ---- |
| Settings/config | user/project config, diagnostics | load/save/resolve | `packages/coding-agent/src/core/settings-manager.ts`, `config.ts` |
| Models store | model catalog and resolver inputs | load/cache/resolve | `packages/coding-agent/src/core/models-store.ts`, `model-resolver.ts` |
| Sessions | transcripts, branches, snapshots | create/load/export/share | `packages/coding-agent/src/core/session-manager.ts`, `session-export.ts` |
| SQLite backend | persistent sessions/search/facts | repo/storage/search | `packages/session-backends/sqlite-node/src/sqlite/**` |

## 复杂页面精读（3–5 个）

Large repository mode used signature/directory extraction instead of full file reads for every source file (>500 source files). Prioritize these files for task-specific deep reads:

- `packages/coding-agent/src/core/agent-session.ts` — agent loop/session behavior.
- `packages/coding-agent/src/core/model-runtime.ts` — model execution path.
- `packages/coding-agent/src/modes/interactive/interactive-mode.ts` — TUI runtime integration.
- `packages/ai/src/api/openai-responses.ts` — provider adapter pattern.
- `packages/byz/src/**` — BYZ product layer and workflow behavior.
