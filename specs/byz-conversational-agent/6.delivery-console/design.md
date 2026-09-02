# Delivery Console — 技术设计

## 设计版本

| 日期 | 版本 | 说明 |
| --- | --- | --- |
| 2026-09-02 | v1 | 初始设计；生产 release 只读 |

## 项目架构

- 架构类型: npm workspace monorepo；BYZ managed extension + trusted-project Git/GitHub adapter。
- 涉及层: delivery scope tracker、Git snapshot reader、intent reducer、controlled action runner、Conversation command UI、Session receipts、temp-repo tests/TUI。
- UI 基准: 复用 Conversation Shell 结构级终端基准；summary 默认紧凑，高影响 preview 通过 confirmation 展开。

## 波及面

- Feature 4 registry：提供 current sealed plan、generation、task/evidence provenance；不新增 mutation API。
- 新增 `packages/byz/src/delivery/**`：scope tracker、git projection、intent state、action runner、delivery extension。
- `packages/byz/src/adapters/pi/pi-runtime-adapter.ts`：新增 trusted DeliveryPort，投影 project trust/UI/Session receipt 与参数数组 exec；不开放任意 shell 字符串。
- `packages/byz/src/application/ports/runtime.ts`：定义 closed Git/gh request/response 类型。
- `packages/byz/src/cli.js`：组合 registry、delivery scope tracker 和 extension。
- `packages/byz/src/conversation/conversation-extension.js`：只在 explicit details/status 显示交付摘要，不把路径/remote 塞入默认运行单行。
- Git release scripts：只读探测；V1 `/deliver release` 不调用。
- Tests：fake runner、临时 repo/bare origin、本地 gh fixture；禁止真实 remote、真实 token 或 npm publish。

## 功能模块设计

### 1. Delivery scope tracker

独立 service 监听 bounded tool start/end，并在 Feature 4 registry 有 sealed plan 时关联 generation/task：

- edit/write 首次成功 end 后，把经过 workspace containment + realpath/symlink 检查的 project-relative target及其 post-mutation SHA-256 加入 `observedMutationPaths`。digest 只用于证明当前字节仍等于本计划最后一次观察结果，不读取或保存正文。
- 同一路径后续 matched mutation 用新 sequence/digest 覆盖；无稳定 toolCallId、失败调用、registry unavailable、workspace 越界和无法规范化路径均不进入 scope。
- scope receipt 写 `byz.delivery.scope.v1` Session custom entry，只保存 project-relative path、post digest、plan generation、taskId 和 sequence。append 成功后才提交内存 scope；reload 按 sequence/generation 严格重放，损坏 generation unavailable。
- `/deliver` 前重新 hash candidate；与最后 receipt digest 不同表示另一 Session/进程或未观察工具改写，必须 excluded，不能 stage。
- 该路径信息只供 explicit `/deliver` details/preview；Conversation compact 和 registry receipt 不读取。

Git status 是最终 changed truth；observed scope + matching post digest 只是“本计划可申请交付”的上限。

### 2. Read-only Git snapshot

`createGitSnapshot()` 仅由 `/deliver*` 显式调用：

- canonical Git root、trusted project、HEAD、branch/detached、index/worktree status、conflicts、tracking、remote aliases、origin host。
- porcelain `-z` 解析后只产生 closed records `{relativePath, indexState, worktreeState, untracked}`；不读取 diff/body/file content。
- remote URL 只投影 host/repository identity，移除 userinfo/query，不回显 credential。
- fingerprint 对 HEAD、branch/upstream、index/worktree closed status、candidate content digests、origin identity、remote branch OID、registry generation 和 scoped paths 做稳定 SHA-256；PR/merge intent 另外绑定 PR number、head/base SHA、mergeability 与 required-check conclusions。不包含文件正文。

startup、session_start、normal turn 不调用 Git。

### 3. Delivery readiness projection

pure selector 输出：

```text
scope: ready|dirty_excluded|conflicted|unavailable
verification: verified|partial|unknown|failed
commit: ready|blocked|done
push: ready|blocked|done
pr: ready|blocked|done
merge: ready|blocked|done
release: informational readiness only
```

- current diff ∩ observed scope = candidate paths。
- 任何 staged/untracked/dirty path 不在 scope 中均 excluded；不自动 stage/restore。
- conflicts、detached HEAD、unknown origin、unsealed registry 或 unavailable evidence 按动作 fail closed。
- declared/observed generic 不能变为 verified pass。

### 4. One-time intent reducer

每次 mutation action 先构造 preview 和 intent：

```text
{ intentId, action, fingerprint, expiresAt, exact paths/refs, consumed:false }
```

- intent 仅内存，最多一个 active，默认 5 分钟；Session 只记录结果 receipt，不保存可重放授权。
- confirmation 文案包含 action、target、影响、推荐和拒绝结果；用户确认后立即重新 snapshot/fingerprint。
- mismatch/expired/cancelled/consumed 拒绝；每个 action 单独 intent，commit confirmation 不授权 push。
- 所有 intent create/confirm/consume 通过单一同步 reducer 线性化；action 开始前原子 consumed，失败不能重用旧 intent。
- confirm 后、执行每个本地或远端副作用前都重读对应 local/remote/PR state；多步骤 action 任一中间状态变化立即停止并分项报告。

### 5. Controlled action runner

通过参数数组调用固定可执行文件，不拼 shell 字符串：

- commit：`git add -- <exact paths>`，复核 staged set 完全相等，再 `git commit -m <validated message>`；pre-existing stage 直接阻塞。
- push：只允许 alias `origin`、非 detached 当前 branch、无 force flags；执行前展示 `<branch>:<branch>`。
- PR：仅 sanitized GitHub origin + available authenticated `gh`；`gh pr create --draft --base ... --head ... --title ... --body-file <temp>`，temp body 是 bounded generated summary，必须 resource cleanup。
- merge：读取现有 PR closed state/checks/mergeability，符合项目策略后使用 `gh pr merge` 的允许方法；不 `git switch main`、不 direct push main、不绕过 required checks。
- release：无 runner 分支；只读 readiness。

command runner 返回 `{exitCode, timedOut, closed stdout fields}`。只解析 commit SHA、PR number/URL、merge state 等必要 bounded receipts；原 stdout/stderr 不进 Session/UI 默认摘要。

V1 不阻止用户在普通 bash 中自行运行 Git；文案明确这不是 sandbox。

### 6. Command UX

```text
/deliver             same as status
/deliver status      read-only summary
/deliver commit      preview → confirm → action
/deliver push        preview → confirm → action
/deliver pr          preview → confirm → action
/deliver merge       preview → confirm → action
/deliver release     read-only readiness/pending checklist
```

command 只在 trusted project 和 Agent idle 时允许 mutation action；运行中只允许 status。所有 action 的 success 以重新读取本地/remote observable state为准，不以 exit code 单独宣称。

### 7. Session receipts and failure handling

`byz.delivery.v1` receipt：action、outcome、plan generation、pre/post safe fingerprint、commit SHA/PR number 等 closed identifiers。不得存 remote URL userinfo、命令、输出、diff、PR body、绝对路径或 credential。

部分成功示例：push 成功、PR 失败，分别记录 push success 与 PR failure；UI 显示 branch 已远端更新但 PR 未创建。cleanup failure 阻塞后续 action。

## 接口契约

```text
DeliverySnapshot = {
  trust: trusted|untrusted
  plan: available|unavailable
  branch?: safe ref
  origin?: { host: github, repository: safe slug }
  candidatePaths: relative paths[]
  excludedCount: safe integer
  conflictCount: safe integer
  evidence: { verified, declared, failed }
  readiness: fixed action states
  fingerprint: sha256
}
```

DeliveryPort 仅允许 fixed subcommands、project trust、closed Session entries 和 `exec(program, args, {cwd, timeout, envAllowlist})`。程序 allowlist 为 git/gh；release/npm/shell 不在 V1。

## 数据模型

- 内存：current snapshot、active one-time intent、action lock。
- Session：scope/results closed receipts。
- 临时：PR body temp file，必须 acquire/release 记录并删除。
- Git/remote 为权威事实源；无新项目状态文件或 delivery 数据库。

## 安全考虑

- 绝不使用 shell command string、force push、`--no-verify`、credential 参数或 upstream remote。
- stage exact paths 前后双校验，保护其他 Session dirty work。
- 每个 remote action 独立确认并绑定 immutable snapshot。
- GitHub auth 由现有 `gh` 环境持有；不读取/记录 token。
- 生产 release、tag、publish、migration、infra 均不执行。
- 这是 workflow gate，不是 OS 权限边界。

## 技术决策

| 决策 | 选择 | 理由 |
| --- | --- | --- |
| 启动行为 | 零 Git，显式 `/deliver` 才读取 | 低噪声且避免隐式外部进程 |
| 可提交范围 | observed scope ∩ matching post digest ∩ Git diff | 同路径被其他 Session 后改也失败关闭，不 stage 混合字节 |
| Git 执行 | program + args allowlist | 避免 shell 注入和命令漂移 |
| 授权 | 每 action 一次性 full local/remote/PR fingerprint intent | 状态变化或跨动作必须重确认 |
| scope replay | append-before-commit receipt + strict generation replay | reload 后不丢 scope，也不接受损坏/未持久状态 |
| remote | V1 仅 origin/GitHub | 不触碰 upstream，范围可验证 |
| merge | 仅 PR 通道 | 尊重 checks/branch protection，不 direct main |
| release | V1 只读 | 生产发布需要独立 smoke 与人工流程 |
| persistence | Session receipt；Git 为真相 | 可审计但不建立第二 Git 状态源 |
