# 编码规范与约定

## 命名

| 对象 | 规则 | 示例 |
| ---- | ---- | ---- |
| Package source files | kebab-case where existing package uses it | `model-runtime.ts`, `session-manager.ts` |
| Types/classes | PascalCase | `AgentSession` |
| Functions/variables | camelCase | `resolveConfigValue` |
| Tests | `*.test.ts` / `*.test.mjs` | `specific.test.ts` |

## 代码风格（自 Biome/tsconfig/AGENTS 推断）

- Tab indentation, indent width 3, max line width 120.
- Strict TypeScript with erasable syntax only in checked source/test paths.
- Top-level imports only; no dynamic or inline imports.
- Prefer small direct changes; inline single-use one-line helpers.
- No new `any` unless there is no typed alternative after checking dependency types.

## 常量

| 常量/配置 | 值/含义 | 定义位置 |
| ---- | ---- | ---- |
| Node engine | `>=22.19.0` | root `package.json` |
| Biome includes | checked TS/JS workspace paths | `biome.json` |
| TS path aliases | workspace source aliases | root `tsconfig.json` |
| BYZ selected CM Workflow | `0.10.4` | README / `packages/byz/workflows.lock.json` |
| BYZ selected CM Plugin | `0.5.0` | README / `packages/byz/workflows.lock.json` |

## 工具函数

| 区域 | 用途 | 定义位置 |
| ---- | ---- | ---- |
| Coding-agent utils | fs, git, shell, json, image, html, text helpers | `packages/coding-agent/src/utils/**` |
| Core tools | read/write/edit/bash/find/grep wrappers | `packages/coding-agent/src/core/tools/**` |
| Release/check scripts | repo automation and validation | `scripts/**` |

## 其他约定

- After code changes, run `npm run check` unless the task is docs-only.
- If a test file is created/modified, run that specific test.
- Changelog updates only under `## [Unreleased]` on `main` or PR context; released sections are immutable.
- Direct external dependencies stay pinned.
