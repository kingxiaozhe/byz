# Safe Pause and Resume — 技术设计

## 设计版本

| 日期 | 版本 | 说明 |
| --- | --- | --- |
| 2026-09-02 | v1 | 初始设计；使用 `/pause resume` |
| 2026-09-02 | v2 | 依赖已合并的 Feature 4 T-009，并要求先完成 session-lineage capability facade |
| 2026-09-02 | v3 | Runtime Boundary 前置更新为人工批准的 T-025 source-binding 替代任务 |
| 2026-09-02 | v4 | Runtime Boundary 前置更新为人工批准的 T-026 canonical-provenance 替代任务 |
| 2026-09-03 | v5 | T-006 采用 payload-free tool batch admission 并关闭第二轮实现审查缺口 |
| 2026-09-03 | v6 | T-007 收紧 tool end projection，并把 pause-aware completion 延迟到 agent_settled |
| 2026-09-03 | v7 | T-008 在真正 paused compact 状态隐藏 pre-hook tool running 噪声 |
| 2026-09-03 | v8 | T-009 使用完整隔离 QA image 绑定最终证据，不改变产品设计 |

## 项目架构

- 架构类型: npm workspace monorepo；BYZ managed extension + Pi agent loop hooks。
- 涉及层: pause gate service、application/runtime ports、Pi Adapter、Conversation timing/status、Session receipts、focused tests/TUI。
- UI 基准: 复用 Conversation Shell 结构级基准；不覆盖 Pi `/resume`。

## 波及面

- `open-source-runtime-boundaries` T-026：先关闭 canonical creator/re-export provenance、无关同名 import 误报与 `Reflect.defineProperty` 三项最终边界，并保留跨 Session model reference、Prewalk trust check/use、port source 和 composition alias 防线；本 Feature 只在该边界上新增最小 PausePort。
- `packages/byz/src/execution/execution-registry.js`：只提供冻结 snapshot/subscribe；pause 不修改 registry task/evidence。
- 新增 `packages/byz/src/execution/pause-controller.js`：管理 requested/paused gate 与 generation。
- `packages/byz/src/adapters/pi/pi-runtime-adapter.ts`：为 pause port 投影 streaming command context、`context`、`tool_call`、tool lifecycle、AbortSignal 与 Session append；不暴露 raw messages。
- `packages/byz/src/application/ports/runtime.ts`：增加最小 PausePort。
- `packages/byz/src/conversation/turn-timing.js`：从单一 confirmation waiting 扩展为 fixed wait reason `confirmation|pause`，保持 monotonic。
- `packages/byz/src/conversation/conversation-extension.js`：selector 加入真实 paused 状态和 pause wait summary；requested 不覆盖在途工具/模型事实。
- `packages/coding-agent/src/core/agent-session.ts` / extension runner：现有 `tool_call` 与 `context` handler 已 await；原则上无需修改，若测试证明 AbortSignal 无法释放 awaited hook，才做最小 runtime 补充。
- Pi interactive `/resume` built-in：不修改。

## 功能模块设计

### 1. Pause controller

service public 状态：

```text
idle → running → requested → paused → resuming → running
                         ↘ stale/cancelled → idle
```

内部持有 generation、request monotonic time、paused time、typed deferred gate、admitted/in-flight tool IDs、当前 live run identity、shared confirmation lease 和 paused-boundary registry snapshot。

- `startRun()` 建立 running identity；`request()` 仅 running 可进入 requested，重复调用返回同 snapshot。
- `reachBoundary(kind)` 在 pause requested 且 admitted/in-flight 已清空时原子采样完整 bounded registry snapshot，进入 paused 并 await typed gate。
- gate outcome 固定为 `resumed|cancelled`。只有同 generation `resume()` 产生 resumed；hook 收到 resumed 才可正常返回并继续 action。
- `abort()/settle()/reload()/shutdown()` 先产生 cancelled，再使 generation 失效；被阻塞的 tool hook 必须返回 block，model gate 必须抛出固定 cancellation，不能把“释放 Promise”误当授权。
- `agent_end` 不是 terminal：自动 retry、compaction 和 queued continuation 可能继续；只有已存在且由 Adapter 显式 allowlist 投影的 `agent_settled` 才 settle。
- command、tool/model hook、tool end、resume 和 settle 都进入同一个同步 reducer linearization queue；任何 handler 在首次 `await` 前先原子保留 generation/op sequence 和 gate ownership，回来后再次校验，防 request/resume/boundary 交错丢失唤醒或双放行。
- snapshot 深冻结，含 fixed state、waitMs、safe boundary kind 和实际 paused 边界的完整 registry snapshot。

### 2. Safe boundary hooks

新增 pause extension 订阅并补齐一个 product-neutral runtime gate：

- `tool_batch_start`：Pi 在 parallel preparation loop 的首次 await 前一次性投影本批全部 bounded toolCallId/toolName，controller 将 running generation 的整批加入 admitted；不包含参数。这样批次准备期间收到 pause 时，后续同批 `tool_call` 仍可完成 preparation，不会等待前序尚未启动的 executor 形成死锁。
- `tool_call`：工具执行前 awaited hook。已由同批预 admitted 的调用允许继续并直到 matched end 才移除；request 后新批次到达的调用在旧 admitted/in-flight 清空后进入 gate。只有 resumed outcome 返回 undefined；cancelled 返回 `{ block:true, terminate:true }`。
- `tool_execution_start/end`：维护 started/in-flight set；end 同时收口对应 admitted ID。进入 paused 必须同时满足 pre-pause admitted 和 in-flight 均为空，解决“hook 已放行但 start 事件尚未观察”的窗口。
- 新增 payload-free `model_request_gate`：在每次真实 Provider streamFunction 调用前 await，覆盖普通 Agent、自动 retry、auto/manual compaction、branch/session summarization 及各自 retry。该 gate 不暴露或修改 payload；requested 时只有 resumed outcome 才继续，cancelled 抛固定 abort error。
- `agent_end`：只记录一次 run segment 结束，不清 pause request。
- `agent_settled/session_shutdown`：确认没有 retry/compaction/queue continuation 后收口；reload/shutdown 先取消 gate再替换 extension。

已开始 Provider stream 不强制 abort。若整个 run 到 agent_settled 前没有下一 gate，request 以 `completed_before_pause` 收口并提示没有可 resume 的 live call。

`model_request_gate` 是本 Feature 明确需要的 Pi runtime contract 变化；现有 `context` 事件只覆盖 Agent 消息组装，不能证明覆盖直接 compaction/summarization 调用，禁止用它冒充全路径 gate。

### 3. Command contract

只注册一个 `/pause` command，避免 Pi built-in `/resume` 冲突：

```text
/pause          request
/pause resume   resume current live gate
/pause status   read snapshot
/pause cancel   equivalent to resume without task mutation
```

command 在 streaming 期间由 Pi 立即执行。idle、confirmation waiting、stale 或错误状态返回固定安全文案。`request()` 成功后 audit receipt append 为 best effort；append 失败只发 warning，不让用户看到“命令失败”同时保留隐式 armed request。自然语言“暂停/继续”是否映射到命令不在 v1；不解析普通 Prompt 触发控制动作。

### 4. Wait accounting and display

Conversation 与 Pause 共享一个 generation-bound confirmation lease；presenter 开始/结束时更新 lease。modal 收到 `/pause` 时显示“确认期间不可暂停”并循环等待原选择，不调用 fallback confirm，也不建立 pause gate。

`turn-timing.js` 把 waiting 变成 fixed-reason totals：

```text
pause(reason) → settle active segment → start wait reason
resume(reason) → settle matching wait → resume previous active stage
```

嵌套 reason 不允许：confirmation waiting 时 pause request 返回 unavailable；paused 时 confirmation 不会开始，因为 agent loop gate 未释放。错误 reason/generation 为 no-op。

Conversation selector 优先级：

```text
confirmation waiting > truly paused > in-flight tools > recover > think/reply
```

requested 不是已暂停：compact 仍显示真实 tool/model 状态，可在 details 增加固定“等待安全暂停”。真正 paused 显示 `已暂停 · {pause wait}`；完成摘要独立列出 `暂停` 与 `等待确认`。`/pause status` 用 live run identity 区分 running/idle，不直接把 controller 内部无请求状态都显示成 idle。

### 5. Session receipt and stale recovery

accepted request/paused/resume/abort 写 `byz.pause.v1` closed custom entry：schema、generation、state、boundary kind、registry plan/task ID 和 monotonic duration bucket；不写正文/路径。

reload/resume 重放只用于审计。没有内存 deferred gate 时，最后状态 requested/paused 一律投影为 `stale`；用户必须重新发起 Agent turn，不能 `/pause resume` 复活不存在的 Promise/provider/tool。

## 接口契约

```text
PauseSnapshot = {
  state: idle|running|requested|paused|resuming|stale
  generation: safe integer
  waitingMs: safe integer
  boundary?: model|tool
  pausedRegistrySnapshot?: ExecutionSnapshot
}

PauseController = {
  startRun(runIdentity)
  request(liveRun, confirmationLease)
  admitTool(toolCallId)
  settleTool(toolCallId)
  reachBoundary(kind, signal): Promise<resumed|cancelled>
  resume(generation)
  settle(reason)
  snapshot()
  subscribe(listener)
}
```

PausePort 只允许 `/pause`、fixed hooks 和 closed Session entries。raw provider payload、messages、tool input/result 不进入 BYZ pause service。

## 数据模型

- live gate 仅内存存在；不能序列化 Promise/AbortSignal。
- Session receipt 只存 fixed audit state；重启后不恢复执行栈。
- Registry plan/task 是只读引用，不复制任务状态。

## 安全考虑

- pause 是协作控制，不是进程/网络/权限沙箱。
- 已开始工具和请求可能产生副作用；文案必须明确“将在安全边界暂停”。
- abort/shutdown 必须释放所有 await，防永久 hang。
- 任何旧 generation continuation 在读取/修改状态前校验 generation。
- `/pause resume` 不授予新工具/远端权限；原有 confirmation 仍生效。

## 技术决策

| 决策 | 选择 | 理由 |
| --- | --- | --- |
| 命令 | `/pause`, `/pause resume`, `/pause status` | 保留 Pi `/resume` Session selector |
| 暂停语义 | 协作式 safe-boundary gate | 不强杀在途工具/provider，避免半执行 |
| hook | awaited `tool_call` + 全路径 `model_request_gate` | `context` 不覆盖 compaction/summarization，必须在真实 streamFunction 边界统一拦截 |
| gate 结果 | typed `resumed|cancelled` | shutdown/reload 释放 Promise 不能误授权 action |
| 并行工具 | admitted + in-flight 批次收口后暂停 | 关闭 tool_call 已放行但 start 尚未观察的竞态 |
| terminal | Adapter allowlist 的 `agent_settled`，非普通 `agent_end` | 保留 retry/compaction/queue continuation 的 pause request |
| 并发线性化 | 同步 reducer queue + await 前后 generation/op sequence 校验 | 防 request/resume/hook race、丢失唤醒和双放行 |
| confirmation | shared lease + modal 特判 `/pause` | 防双重 gate 和误触 fallback confirm |
| 重启恢复 | stale，不恢复调用栈 | Session entry 不能复活 Promise/provider stream |
| timing | fixed wait reason `pause` | 与模型、工具、confirmation 分账 |
| registry | 只读 Feature 4 T-009 snapshot | pause 不得伪造任务完成或 evidence |
| 执行顺序 | Runtime Boundary T-026 完成后再新增 PausePort | 避免在 creator provenance 或 reflective raw mutation 尚未关闭时继续扩展能力 |
