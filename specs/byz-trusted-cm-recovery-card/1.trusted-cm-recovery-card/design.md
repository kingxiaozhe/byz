# Trusted CM Recovery Card — 技术设计

## 设计版本

| 日期 | 版本 | 说明 |
| --- | --- | --- |
| 2026-08-31 | v1 | 初始设计 |
| 2026-09-01 | v2 | 以替代任务收紧 CM schema 与 review frontmatter 的失败关闭合同 |
| 2026-09-01 | v3 | 删除全局索引与 Git working-tree 查询，收敛项目内证据和验证矩阵 |
| 2026-09-01 | v4 | 用 canonical line protocol 与三条精确回归替代宽泛 YAML 等价判断 |
| 2026-09-01 | v5 | 以 tests-only T-012 补齐 reader 生命周期和 identity/file-type 矩阵 |

## 项目架构

- 架构类型: Node.js npm-workspaces monorepo，BYZ 产品层复用 Pi coding-agent runtime
- 涉及层: BYZ application ports、Pi adapter、BYZ recovery application/adapters、BYZ CLI composition、Conversation 启动呈现、local diagnostics、npm package tests
- 不涉及: 新数据库、CM Workflow 写路径、Pi Session 存储格式、Provider API、网络服务、第三方运行时依赖
- 上下文范围: 完整；本功能安全敏感且跨 BYZ、Pi lifecycle、CM artifacts、Git 与打包边界

## 现有能力复用

| 能力 | 现有来源 | 本功能做法 |
| --- | --- | --- |
| 项目信任 | Pi `ctx.isProjectTrusted()` / `SettingsManager` | 直接使用有效 trust 结果，不新建 BYZ trust store |
| CM 当前运行定位 | 当前项目直属 `specs/*` | 最多 64 个真实直属目录；不读取全局 CM 索引或跨项目状态 |
| CM 状态与证据 | `.cm-specs-status`、`.cm-status.json`、`.cm-run.json`、`tasks.md`、当前任务 `.reviews/` header | 严格 allowlist 投影，不读取完整运行日志/QA/delivery，不执行内容、不写回 |
| Session lifecycle | Pi `session_start` reason 与只读 Session entries | Adapter 投影 reason/hasHistory，不暴露正文或 handle |
| Git HEAD | 系统 `git` | 只在 details 中固定执行 `rev-parse --verify HEAD`，无 shell、超时/输出上限 |
| UI | BYZ extension `ui.notify` 与 command registry | 紧凑卡和 `/project` 显式入口，不新增 TUI 框架 |
| 安全文件读取 | `packages/byz/scripts/build-support.mjs` / `artifact.mjs` 的 lstat/realpath/O_NOFOLLOW/handle.stat 模式 | 抽取同等不变量到 runtime-safe helper；不从发布脚本复制弱化版本 |
| 外部项目经验 | projectmem brief、OwnMem evidence governance | 只借鉴交互与证据原则，不引入依赖或平行存储 |

> Pi project trust 是输入加载边界，不是系统沙箱。`isProjectTrusted() === true` 可能来自保存决策、运行参数、默认策略或“没有 Pi 判定为需确认的项目资源”。因此恢复 reader 即使在 trusted context 中也必须继续把 CM/Git 内容当作不可信数据，执行 no-follow、边界、大小和内容清理；本功能不宣传更强隔离。

## 总体数据流

```text
Pi session_start / /project command
        │
        ▼
RecoveryPort (cwd, effective trust, reason, hasHistory, notify only)
        │ trust check + cancellation generation
        ▼
RecoveryCoordinator
        ├── CmRunLocator ──> trusted-project specs direct children only
        ├── CmEvidenceReader ──> minimal project-local CM allowlist
        └── GitHeadReader ──> details-only fixed rev-parse argv
        │
        ▼
Pure RecoveryReducer + sanitizer
        │
        ▼
RecoveryProjection + EvidenceReceipt
        │ revalidate trust/identity
        ▼
compact/details renderer ──> ui.notify
```

首屏读取是一次性异步 operation。它不阻塞 TUI ready，不安装 watcher/daemon/heartbeat；`session_shutdown` 或新 generation 会取消/废弃旧结果。

## 功能模块设计

### 模块 1：Recovery domain projection

新增 `packages/byz/src/recovery/recovery-state.js`，只处理 plain data：

- 严格解析 CM manifest/status/run pointer、task checkbox 和当前 review frontmatter 的 allowlisted 字段；首版无日志 envelope parser。
- `[v2]` parser 与 reducer 之间采用完整封闭投影：数组成员、可选字段和嵌套记录必须逐项满足精确类型与上限，不得通过过滤、空字符串替换或其他有损归一化把未知/部分 schema 变成有效证据。任一结构不完整、字段类型未知或投影来源不可证明时，整项来源返回 `unavailable`。
- `[v4]` review frontmatter 不是通用 YAML 输入。parser 只接受 CM canonical `key: value` 标量行；受保护 authority key 必须各出现一次。任何 quoted/escaped key、以 `?` 或 `:` 开头的 YAML explicit-key 行、受保护 key 的非 canonical 冒号空白或重复 key 都使整个 review 不可用；实现不得引入 YAML parser 或尝试枚举 YAML 语义等价形式。
- `[v4]` task parser 只接受 canonical `- [ ] T-xxx: title` / `- [x] T-xxx: title`。任何以 `- [` checkbox 与 `T-` task 形状开头但未匹配完整 canonical 行的输入，使整个 task 来源不可用，不能静默忽略。
- `[v4]` reducer 收到的 review 必须全部属于选定当前 task；任一 mismatch 直接进入 `needs-reconciliation`。T-011 是 T-010 两轮阻塞后的独立替代任务，只接管这三条回归并重新走 N4，不继承 T-010 的 attempt、review 或完成状态。
- 对自由文本只调用统一 sanitizer；文本永远不能决定状态或动作。
- 以固定优先级归并状态：
  1. 证据 identity 冲突、多个 active candidates、task/current-review 不一致 → `needs-reconciliation` 或 `needs-decision`；
  2. 当前 attempt 有结构化 `verdict: blocked` 或不可继续的终态 → `blocked`；
  3. `awaiting_review`、`paused_for_human`、待审批/待决定 → `needs-decision`；
  4. active run、未完成 task、无冲突且允许按原 workflow 恢复 → `resumable`；
  5. 关键来源不可读/语义未知 → `unavailable`。
- `detail`、review body、task title 可作为经清理说明，但不参与上述 precedence。
- 首版只读取当前 task 相关 review frontmatter/handoff header，并显示为历史 CM 记录；不读取历史 QA、delivery 或完整 review body。reader 不读取/重算源码，因此不能声称 `implementation_sha256` 仍匹配、review 仍可批准 N5 或任务已由当前字节证明完成。`resumable` 仅表示可以重新进入 CM，让 CM 自己的 task gate 重验当前内容。
- 从 allowlist workflow 生成建议入口，例如 `cm-ai`、`cm-prd`、`cm-fix`、`cm-refactor`；未知 workflow 只显示“查看状态”，不能拼装命令。

建议纯数据合同：

```ts
type RecoveryStatus =
  | "resumable"
  | "needs-reconciliation"
  | "needs-decision"
  | "blocked"
  | "unavailable";

interface RecoveryProjection {
  status: RecoveryStatus;
  feature?: string;
  task?: string;
  node?: string;
  state?: string;
  reasonCode: string;
  summary?: string;
  nextEntry?: "cm-ai" | "cm-prd" | "cm-fix" | "cm-refactor";
  session: { reason: "startup" | "reload" | "new" | "resume" | "fork"; hasHistory: boolean };
  git?: { state: "available" | "unavailable"; shortHead?: string }; // details only
  evidence: readonly RecoveryEvidence[];
  receipt: EvidenceReceipt;
}
```

实际实现使用项目允许的 erasable TypeScript 或 JavaScript，不引入 `enum`。

### 模块 2：Project-local CM locator and evidence reader

新增 `packages/byz/src/recovery/cm-evidence-reader.js` 与共享 runtime-safe no-follow helper。

**Local locator**：

- trust 为 false 时立即返回 `not-eligible`，在此之前不得 `stat/open/readdir/spawn`。
- 只枚举 `<project>/specs` 最多 64 个直属真实目录；不读取 `CM_WORKFLOW_LOG_HOME`、`~/.cm-workflow`、全局 index 或其他项目。
- candidate 必须是 `<canonical-project>/specs/<one-direct-child>`，拒绝嵌套、`.`/`..`、编码绕过、路径分隔符混淆和 canonical 越界。
- `.cm-run.json.status == "running"` 的目录是 active candidate；done run 只有在 `.cm-specs-status == "awaiting_review"`、`.cm-status.state` 为 paused/blocked 或当前任务 review 仍未决时才是 actionable candidate。
- 不按目录名、mtime、自然语言或历史日志猜状态；多个 active/actionable candidates 返回 `needs-decision`。

**Minimal evidence snapshot**：

- 允许的来源固定为 `.cm-specs-status`、`.cm-status.json`、`.cm-run.json`、feature-local `tasks.md` 和当前 task 相关 `.reviews/` header；首版不打开 `运行日志.jsonl`、历史 QA/delivery 或无关 review body。
- project/specs/candidate 先做 lstat 与 realpath containment；叶子文件以 `O_NOFOLLOW`（平台支持时）打开并通过 handle `stat` 验证 regular file。Windows 显式拒绝 lstat/realpath 可见的 symlink、junction 或 reparse escape；平台无法提供所需 final-component 检查时返回 unavailable。
- 读取前后重验 project/specs/leaf identity、size，并对实际读取字节计算 SHA-256 receipt；变化即丢弃整次 snapshot，字节不进入 parser projection、UI 或 diagnostics。
- 硬上限：直属候选 64 个、当前 task review 文件 4 个、单状态文件 1 MiB、单 review 512 KiB、单 snapshot 总读取 4 MiB。上限可注入测试但生产值不得扩大到无界。
- 本边界防止预存路径逃逸和检测到的读取期变化，不声称抵御同一 OS 用户的并发恶意进程；需要该威胁模型时使用容器或 OS sandbox。
- `[v5]` T-012 接管 T-003 当前 reader 字节，只允许新增/调整测试 fixture 与发现测试证实的最小缺陷；必须分别覆盖 done + awaiting_review、paused、blocked、done-resolved，project/specs/leaf identity replacement，非普通叶子，以及当前平台可构造的 junction/reparse 变体。平台不支持的 junction 变体必须显式记录 skip 原因，不能伪造通过。

### 模块 3：Details-only Git HEAD

新增 `packages/byz/src/recovery/git-head.js`：

- 仅 `/project details` 在二次 trust gate 通过后调用；startup/status/dismiss 不 spawn Git。
- 只允许固定 `git rev-parse --verify HEAD` 参数数组；使用 `shell: false`、固定 cwd、`GIT_OPTIONAL_LOCKS=0`、`GIT_TERMINAL_PROMPT=0`、AbortSignal/timeout 和 stdout/stderr 字节上限。
- 不接受 CM 内容提供 executable、argv、env 或 cwd；不运行 `git status`、hooks、fsmonitor、submodule 命令，不读取 branch、文件名、diff、remote 或原始输出。
- 成功只返回校验后的短 HEAD；Git 缺失、仓库损坏、超时、超限或非零退出返回 unavailable，不阻塞卡片或输入。
- HEAD 只是 details 当次参考信息，不参与 CM `resumable` 或 snapshot reconciliation。

### 模块 4：Minimal Pi recovery facade

扩展 `packages/byz/src/application/ports/runtime.ts` 和 `packages/byz/src/adapters/pi/pi-runtime-adapter.ts`，增加独立 `RecoveryPort`，不把文件读取塞进 Pi adapter：

```ts
interface RecoveryContext {
  cwd: string;
  isProjectTrusted(): boolean;
  readSessionSummary(): { hasHistory: boolean } | undefined;
  ui: NotifyUiPort;
}

interface RecoveryPort extends EventPort<RecoveryContext>, CommandRegistrationPort<RecoveryContext> {}
```

- 仅允许 `session_start`、`session_shutdown` 和命令 `project`。
- Adapter 在创建/分发 RecoveryContext 前先调用 raw context 的 trust getter；untrusted 时不得读取 Session。`readSessionSummary()` 是惰性闭包，每次调用先再次检查 raw trust，只有 trusted 才调用 `getEntries()` 并立即折叠为 `hasHistory`；不传正文、路径或 manager handle。
- facade 是冻结 plain object；属性枚举和 spy 测试必须证明 untrusted context 下 `getEntries()` 为零调用，且不存在 raw/api/pi/context/sessionManager/filesystem/managed replacement。
- Recovery 使用自己的 capability slice，不复用高权限 workflow port，也不扩张 Prewalk/Fast/Conversation 能力。
- ordinary Pi 未装配 BYZ recovery factory 时无行为变化。

### 模块 5：Recovery coordinator and presentation

新增 `packages/byz/src/recovery/recovery-extension.js`：

- `session_start` 中先检查 interactive-capable context 与 trust，再启动一次性 CM snapshot；handler 不等待文件 I/O 才释放 startup，且 startup 不调用 Git。
- 与 Conversation 扩展的 welcome 顺序固定为 welcome 后 recovery card；通过 CLI composition 顺序和集成测试保证，不改写 assistant message。
- compact card 只显示项目名、Feature/Task、status、可信 reason summary 和固定 next entry；相对 evidence path 与当前 review 摘要只在 details 中显示。
- `/project status` 重新读取 CM 并展示 compact；`/project details` 二次检查 trust、重新读取 CM，再惰性读取当前短 HEAD；`/project dismiss` 只设置 extension 内当前 Session dismiss flag。
- reload 保留 dismiss/已展示状态且不重复提示；new/resume/fork 重置当前 Session flag。
- 所有异步结果绑定 generation；shutdown、trust 撤销或后续 snapshot 启动使旧 generation 失效。
- 所有 renderer 输入先经过 sanitizer：去 ANSI/OSC/C0/C1、双向控制、CR/LF 伪造，压缩空白并按字段截断。
- 无 candidate 时静默；安全拒绝或 reader degrade 每 session 最多 notify 一次简短 warning。

### 模块 6：Diagnostics and package boundary

复用现有 `byz.diagnostics.degrade`：

- 仅为 `COMPONENTS` 增加 `recovery`，reason 复用/收敛到 `permission | invalid_record | corrupt_file | schema_mismatch | unknown` 等现有安全枚举；不记录路径、文本、命令输出或异常原文。
- CLI 将已有 diagnostics recorder 以最小 callback 注入 recovery extension。
- build 已编译完整 `src` tree；manifest 不添加项目数据。
- packed-runtime fixture 只在最终包边界执行一次：在隔离 HOME 和仓库外 trusted project 中合成最小 CM 记录，验证 card，并枚举 tar 内容与文本，拒绝 specs/log/本机路径/secret marker。后续若产物字节未变化，最终审计复用该 receipt，不重复同一矩阵。
- 首版 package.json 不新增 runtime dependency，不安装 hook/watcher/daemon。

## 接口契约

### Recovery source result

所有 adapter 返回封闭结果，不抛原始错误到 UI：

```ts
type SourceResult<T> =
  | { state: "found"; value: T; receipt: SourceReceipt }
  | { state: "absent" }
  | { state: "rejected"; reasonCode: string }
  | { state: "unavailable"; reasonCode: string };
```

`reasonCode` 来自固定 allowlist；错误对象、路径和来源文本留在进程内且不进入 diagnostics/UI。

### Evidence receipt

```ts
interface SourceReceipt {
  relativePath: string;
  sha256: string;
  size: number;
  identity: string;
}

interface EvidenceReceipt {
  projectIdentity: string;
  specsIdentity: string;
  runId: string;
  sources: readonly SourceReceipt[];
}
```

receipt 只用于同进程重验，不持久化为新的项目事实源。

### `/project` command

| 参数 | 行为 |
| --- | --- |
| `status` 或空 | 重新读取并显示 compact card |
| `details` | 重新读取并显示 details card |
| `dismiss` | 当前 Session 不再自动提示；手动 status/details 仍可查看 |
| 其他 | 固定 usage warning，不读取来源来生成帮助 |

## 数据模型

本功能无数据库与 migration。所有 projection/receipt/dismiss/generation 仅存在于当前 extension 生命周期内。CM、Pi Session 与 Git 继续各自拥有数据。

## 安全考虑

- **Trust-first**：trust check 必须是所有 I/O 和 process spawn 前的首个可观察动作，并在显示/动作前复查。
- **No-follow 与威胁边界**：路径字符串 canonical 检查不是充分条件；必须结合 project/specs containment、candidate lstat、final-component open no-follow、handle stat 和 pre/post identity。预存 escape 读取前拒绝；检测到变化后不发布字节。本功能不把同一 OS 用户下的并发 race 包装成沙箱保证。
- **Bounded parsing**：所有项目字节先受候选数、review 数、单文件和 snapshot 总量限制再解析；首版不打开 JSONL。
- **Prompt/terminal injection**：CM 文档是数据而非指令；不注入 system prompt，不执行命令，UI 输出严格清理。
- **No authority from text**：只有 schema allowlist、任务 checkbox 与当前 review header 决定状态；自然语言不能授权恢复。
- **No secret expansion**：不读取 env files、auth storage、Session body、Git status/branch/remote 或 diff；details Git subprocess 使用最小固定环境。
- **TOCTOU**：CM snapshot receipt + generation + trust/source identity revalidation；Git HEAD 是 details 当次上下文，不加入 CM snapshot。
- **Failure isolation**：reader/gitter/renderer/diagnostics 失败不得改变 BYZ exit code、输入可用性或其他 extension 状态。
- **Supply chain**：零新增 runtime dependency；最终 tarball 在隔离环境验证。

## 波及面

| 修改位置 | 直接调用方 | 可能受影响的旧行为 | 回归范围 |
| --- | --- | --- | --- |
| `packages/byz/src/application/ports/runtime.ts` | Pi adapter、BYZ feature factories | capability slice 类型与枚举属性 | architecture tests、tsgo |
| `packages/byz/src/adapters/pi/pi-runtime-adapter.ts` | BYZ CLI composition | diagnostics/workflow/Fast/Prewalk/Conversation 既有投影 | architecture、Fast、Prewalk、workflow、Conversation tests |
| `packages/byz/src/cli.js` | npm `byz` executable | startup extension 顺序、interactive/non-interactive routing | smoke、packed-runtime tests |
| `packages/byz/src/conversation/**`（只验证，不混入 recovery 逻辑） | BYZ managed extension | welcome、footer、progress card、commands | conversation tests |
| `packages/byz/src/diagnostics/schema.js` | recorder/reader/export/update-health | strict schema 接受范围 | diagnostics tests |
| `packages/byz/src/recovery/**` | recovery extension only | 新功能，无旧调用方 | focused recovery/security tests |
| package build/packed runtime | npm consumers | published file set、startup outside repo | build/package/packed-runtime tests |

业务地图中的 `BYZ workflow lifecycle`、`BYZ conversation timing` 和 `BYZ local diagnostics` 都被触及，但产品 feature 仍是一条用户可感知的“启动恢复”线路；跨模块任务必须显式列模块，不能把同一文件行为拆散。

## 技术决策

| 决策 | 选项 | 理由 |
| --- | --- | --- |
| 状态来源 | 项目内 CM + Pi Session；Git HEAD 仅 details | 聚焦恢复方向，不把上下文信息升级为状态权威 |
| active specs 定位 | 当前项目直属 bounded scan | cwd 已知，避免全局索引和跨项目身份对账 |
| trust | Pi effective project trust | 不建立平行授权；reader 仍按不可信数据处理 |
| UI | 独立 RecoveryPort + notify/command | 最小能力，不把 raw Pi 或 Conversation 高权限暴露给 reader |
| 启动 | 一次性异步、generation cancel、零 Git spawn | 不阻塞输入，不引入 watcher/heartbeat |
| Git | details-only 固定 `rev-parse HEAD` | 保留当前 commit 参考，推迟 working-tree 与 repo-config 防御矩阵 |
| 存储 | 纯内存 projection/receipt | 首版只读，不创造 checkpoint/记忆系统 |
| 外部方案 | 借鉴、不集成 projectmem/OwnMem/Beads/Brigade | 避免 Python/hooks/watcher、repo memory 和 CM 重复控制面 |

## 设计基准

无外部视觉设计稿。恢复卡沿用现有 BYZ `ui.notify` 文本风格，不生成 UI 像素还原任务；结构与信息顺序由 requirements AC 验收。
