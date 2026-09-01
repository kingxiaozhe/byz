# Trusted CM Recovery Card — 任务清单

## 任务版本

| 日期 | 版本 | 说明 |
| --- | --- | --- |
| 2026-08-31 | v1 | 初始任务 |
| 2026-09-01 | v2 | 停止两轮审查阻塞的 T-002，新增 T-010 替代任务并重排依赖 |
| 2026-09-01 | v3 | 删除全局索引与 Git status，缩小证据集并去重最终验证 |
| 2026-09-01 | v4 | 停止两轮阻塞的 T-010，新增三条精确回归替代任务 T-011 |
| 2026-09-01 | v5 | 停止两轮测试矩阵阻塞的 T-003，新增 tests-only T-012 |

## 项目信息

- 项目名: pi-monorepo / BYZ
- 架构类型: Node.js npm-workspaces monorepo，TypeScript/JavaScript ESM CLI/TUI
- specs 路径: `specs/byz-trusted-cm-recovery-card/1.trusted-cm-recovery-card/`
- 优先级: P0
- 交付形态: 本地 npm CLI/TUI，无 staging 部署任务

## 任务列表

### 防护网基线

- [x] T-001: 在任何实现修改前记录工作区 dirty 边界，运行 `./test.sh` 全量非 E2E 基线、BYZ package tests、architecture/Conversation/workflow 定向测试、coding-agent project-trust/extension 定向测试和 packed-runtime smoke；区分存量失败与环境阻塞，不修改产品行为 ~1h
  - 模块: `packages/byz/test/**`、`packages/coding-agent/test/**`、`scripts/byz-packed-runtime.test.mjs`
  - 验证: 形成可复跑的命令与基线结果，后续任务不得用真实 provider、付费 token 或生产状态

### 证据投影与安全读取

- [ ] ~~T-002: 实现纯函数 Recovery contracts、CM allowlist parsers、状态 reducer、historical-review 标记和统一 terminal sanitizer，覆盖全部状态 precedence、冲突、未知 schema、控制字符与长度边界 ~1h~~ `[DROPPED v2: 两轮审查后仍有失败开放风险；禁止 attempt 3，由 T-010 替代]`
  - 历史模块: `packages/byz/src/recovery/recovery-state.js`、`packages/byz/test/recovery-state.test.mjs`
  - 历史审查: `.reviews/trusted-cm-recovery-card-T-002-r1.md`、`.reviews/trusted-cm-recovery-card-T-002-r2.md`

- [ ] ~~T-010: 作为 T-002 的独立替代任务，完成 strict parser/reducer/sanitizer ~1h~~ `[DROPPED v4: 两轮审查后仍有3条失败开放路径；禁止 attempt 3，由 T-011 替代]`
  - 历史模块: `packages/byz/src/recovery/recovery-state.js`、`packages/byz/test/recovery-state.test.mjs`
  - 历史审查: `.reviews/trusted-cm-recovery-card-T-010-r1.md`、`.reviews/trusted-cm-recovery-card-T-010-r2.md`

- [x] T-011: [NEW] 作为 T-010 的窄范围替代任务，只修复三条内容绑定回归：拒绝 frontmatter 的 YAML explicit-key `?`/`:` 行，任何 review task 与当前 task 不同即 reconciliation，任何 task-shaped checkbox 非 canonical 即整项 unavailable；不得引入 YAML parser、日志投影或新状态 ~30min
  - 依赖: T-001
  - 模块: `packages/byz/src/recovery/recovery-state.js`、`packages/byz/test/recovery-state.test.mjs`
  - 输入: T-010 attempt 2 当前字节和 `.reviews/trusted-cm-recovery-card-T-010-r2.md`；不继承其 attempt、review 或完成状态
  - 覆盖: AC-007, AC-008, AC-009, AC-017

- [ ] ~~T-003: 实现 project-local bounded no-follow reader 与验证矩阵 ~1h~~ `[DROPPED v5: header-only 缺陷已修复，但第二轮因生命周期和 identity/file-type 测试矩阵不完整而阻塞；禁止 attempt 3，由 T-012 接管]`
  - 历史模块: `packages/byz/src/recovery/safe-read.js`、`packages/byz/src/recovery/cm-evidence-reader.js`、`packages/byz/test/recovery-reader.test.mjs`
  - 历史审查: `.reviews/trusted-cm-recovery-card-T-003-r1.md`、`.reviews/trusted-cm-recovery-card-T-003-r2.md`

- [x] T-012: [NEW] 作为 T-003 的 tests-only 独立替代任务，接管当前 reader 字节并补齐 done + awaiting_review、paused/blocked、done-resolved 候选矩阵，project/specs/leaf identity replacement，非普通叶子和当前平台可用 junction/reparse 变体；除测试证实的最小缺陷外不得修改产品逻辑 ~30min
  - 依赖: T-001, T-011
  - 模块: `packages/byz/src/recovery/safe-read.js`、`packages/byz/src/recovery/cm-evidence-reader.js`、`packages/byz/test/recovery-reader.test.mjs`
  - 输入: T-003 attempt 2 当前字节和两轮 findings；不继承其 attempt、review 或完成状态
  - 覆盖: AC-004, AC-005, AC-006, AC-018

- [x] T-004: [CHANGED v3] 实现 details-only Git HEAD reader，只允许固定 `git rev-parse --verify HEAD`、参数数组、无 shell、optional locks/terminal prompt 禁用、timeout/output 上限；证明 startup/status/dismiss 零 Git spawn，details 失败只返回 unavailable，不读取 branch、status、文件名、diff 或 remote ~30min
  - 依赖: T-001
  - 模块: `packages/byz/src/recovery/git-head.js`、`packages/byz/test/git-head.test.mjs`
  - 覆盖: AC-010, AC-011, AC-013

### Pi capability 与恢复交互

- [x] T-005: 增加最小 frozen RecoveryPort，并在 Pi adapter 内先 trust gate、后惰性 Session summary；只允许 session_start/session_shutdown/project command，显式 allowlist 投影 `startup|reload|new|resume|fork` reason，补五种 reason 的真实 adapter 参数化测试、facade 枚举、untrusted zero-getEntries 和 ordinary Pi 不变回归 ~1h
  - 依赖: T-001
  - 跨模块: `packages/byz/src/application/ports/runtime.ts`、`packages/byz/src/adapters/pi/pi-runtime-adapter.ts`、`packages/byz/test/architecture.test.mjs`
  - 覆盖: AC-002, AC-003, AC-012, AC-020

- [x] T-006: [CHANGED v5] 实现一次性异步 RecoveryCoordinator、compact/details renderer、`/project status|details|dismiss`、session/reload generation 语义和 trust/source 重验；welcome 后显示、startup/status 零 Git，details 在二次 trust gate 后惰性读取 HEAD，无候选静默，任何 reader 失败不阻塞输入 ~1.5h
  - 依赖: T-011, T-012, T-004, T-005
  - 模块: `packages/byz/src/recovery/recovery-extension.js`、`packages/byz/test/recovery-extension.test.mjs`
  - 覆盖: AC-001, AC-013, AC-014, AC-015, AC-016, AC-019

- [x] T-007: 在 BYZ composition root 装配独立 recovery slice，复用现有 diagnostics recorder 记录无敏感内容的 recovery degrade reason，并验证 Conversation 欢迎、Fast、Prewalk、workflow 与非交互 routing 不回归 ~1h
  - 依赖: T-006
  - 跨模块: `packages/byz/src/cli.js`、`packages/byz/src/diagnostics/schema.js`、BYZ smoke/diagnostics/Conversation integration tests
  - 覆盖: AC-001, AC-003, AC-019, AC-022

### 打包与最终验证

- [x] T-008: [CHANGED v3] 在仓库外、隔离 HOME 中执行一次最终 packed-runtime 验证，覆盖 trusted card、untrusted zero-read、包内容、无新增 runtime dependency、无 hooks/watcher/daemon、本机路径/状态/secret marker 不进入 tarball，并记录 artifact receipt ~1h
  - 依赖: T-007
  - 模块: `scripts/byz-packed-runtime.test.mjs`、BYZ build/package tests
  - 覆盖: AC-021, AC-022

- [x] T-009: [CHANGED v3] 复跑全部新增 focused tests、`npm --prefix packages/byz test`、`npm run check` 和 `./test.sh`；若 T-008 后 artifact 输入未变化则核对并复用其 receipt，不重复 packed-runtime 矩阵，若字节变化则必须重跑 T-008；核对最终 diff 只包含批准范围 ~30min
  - 依赖: T-008
  - 模块: 全 feature 验证与审计产物
  - 覆盖: AC-001 至 AC-022

## 依赖关系

```text
T-002, T-010, T-003 (DROPPED; no attempt 3)
T-001 ─┬─> T-011 ─> T-012 ─┐
       ├─> T-004 ──────────┼─> T-006 ─> T-007 ─> T-008 ─> T-009
       └─> T-005 ──────────┘
```

## 风险点

- T-011 已通过独立审查；T-012 必须以新任务身份重新绑定当前 reader 三个文件并完成测试矩阵与 N4，T-003 review 仅作为输入，不得作为批准凭证，也不得创建 T-003 attempt 3。
- T-012 是 tests-only closure，不得借测试缺口重写 reader；只有新增回归先红灯并证明现有行为错误时，才允许最小产品修复。
- canonical line protocol 故意不解析 YAML；实现只需拒绝 explicit-key 标记和非 canonical task/review 形状，禁止重新扩张为 YAML 等价性工程。
- Pi effective project trust 不是沙箱，且在没有 trust-requiring resources 时可能自动为 true；实现必须继续把 CM/Git 内容视为不可信数据，不能在产品文案中宣传隔离保证。
- Node 路径 API 无法对同一 OS 用户的并发 ancestor swap 提供零字节保密；本范围只保证预存 escape 前置拒绝、检测到 project/specs/leaf 变化后不发布字节，并要求强隔离用户使用容器/OS sandbox。
- Git HEAD 只是 details 当次参考，不用于证明代码未漂移；working-tree、branch、fsmonitor/hooks/index 防御矩阵明确推迟到 P1。
- CM review 文件只是历史记录；Recovery Card 不读取源码重算 implementation SHA，不能声称当前代码仍获批准或跳过 CM N4/N5 gate。
- T-022 既有 facade review debt 不在本 feature 内全面修复；RecoveryPort 必须独立满足最小能力和 zero-raw-leak 测试，不得借 P0 扩大为通用架构重写。
- 首版故意不读取全局 CM index、运行日志、历史 QA/delivery；这会减少跨项目恢复上下文，但不影响当前项目的 P0 恢复入口。
