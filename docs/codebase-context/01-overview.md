# 项目概述与技术栈

## 项目定位

BYZ is a business-first CLI product layer built on the Pi coding-agent runtime, with bundled managed workflows and traceable release packaging.

## 技术栈

| 层 | 技术 | 版本 |
| ---- | ---- | ---- |
| Runtime | Node.js | >=22.19.0 |
| Language | TypeScript / JavaScript ESM | TS 5.9.3 |
| Package manager | npm workspaces | lockfile present |
| Formatter/Linter | Biome | 2.3.5 |
| Typecheck/build | tsgo / TypeScript native preview | 7.0.0-dev.20260120.1 |
| Tests | Vitest / node:test | Vitest 4.1.9 |
| Product CLI | @aibyzero/byz | 0.1.5 |
| Pi baseline packages | @earendil-works/pi-* | 0.84.3 |

## 脚本命令

| 命令 | 作用 |
| ---- | ---- |
| `npm ci --ignore-scripts` | Clean dependency install |
| `npm run build` | Build Pi workspace packages |
| `npm run build:byz` | Build Pi packages then BYZ package |
| `npm run build:byz:offline` | Offline BYZ build path |
| `npm run check` | Biome, pinned deps, TS imports, shrinkwrap/install-lock checks, tsgo, browser smoke |
| `./test.sh` | Non-e2e regression path per AGENTS.md |
| `npm run test:scripts` | Root node:test script tests |

## 环境变量（仅键名与用途，不含值）

| 键 | 用途 | 来源 |
| ---- | ---- | ---- |
| `PI_ALLOW_LOCKFILE_CHANGE` | Allow lockfile commits during release/security-reviewed changes | AGENTS.md |
| `npm_config_min_release_age` | Release-only override for npm age gate | AGENTS.md |
| `BYZ_FAST_MODEL` | Optional Fast mode model override | README.md |
