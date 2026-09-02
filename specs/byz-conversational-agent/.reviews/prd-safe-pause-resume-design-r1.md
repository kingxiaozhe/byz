---
at: 2026-09-02T02:34:07-07:00
reviewer: codex-cli
independent: true
stage: design
feature: safe-pause-resume
scope:
  - 5.safe-pause-resume/requirements.md
  - 5.safe-pause-resume/design.md
  - 4.structured-execution-registry/design.md
  - packages/byz/src/conversation/conversation-extension.js
  - packages/byz/src/adapters/pi/pi-runtime-adapter.ts
  - packages/byz/src/application/ports/runtime.ts
  - packages/coding-agent/src/core/agent-session.ts
  - packages/coding-agent/src/core/extensions/types.ts
---

# Independent Design Review

1. **High — premature `agent_end` release bypasses pause on automatic continuation.**
   **Spec:** [design §2 Safe boundary hooks](/tmp/cm-prd-structured-roadmap-design-review/specs/5.safe-pause-resume/design.md:44), specifically `agent_end/agent_settled` both closing the gate.
   **Trace:** Provider is streaming → `/pause` sets `requested` → response ends with a retryable error → Pi emits `agent_end` → controller `finish()` clears the request → `AgentSession._handlePostAgentRun()` schedules retry and calls `agent.continue()`. Pi performs post-run continuation after `agent_end` and emits `agent_settled` only after retries/compaction/queues are exhausted ([AgentSession](/tmp/cm-prd-structured-roadmap-design-review/packages/coding-agent/src/core/agent-session.ts:1088)).
   **Incorrect outcome:** The next Provider request starts despite the accepted pause request.
   **Required correction:** Do not finish a requested pause on `agent_end`. Preserve it across retry, compaction, and queued continuation; normally close only on `agent_settled`. If early completion is needed, Pi must expose an explicit “no continuation will run” signal.

2. **High — `context` does not cover automatic compaction Provider calls.**
   **Spec:** [design §2 Safe boundary hooks](/tmp/cm-prd-structured-roadmap-design-review/specs/5.safe-pause-resume/design.md:44) and [design impact statement](/tmp/cm-prd-structured-roadmap-design-review/specs/5.safe-pause-resume/design.md:23).
   **Trace:** `/pause` becomes requested during the final model stream → response crosses the compaction threshold → `AgentSession` directly invokes `compact()` using `this.agent.streamFunction` ([AgentSession](/tmp/cm-prd-structured-roadmap-design-review/packages/coding-agent/src/core/agent-session.ts:1913)) before any next agent-loop `context` event.
   **Incorrect outcome:** A new summarization Provider request starts before the requested pause. If no later agent request occurs, execution may settle without ever reaching the promised boundary.
   **Required correction:** Add an awaited, payload-free Provider-boundary capability around every direct Provider path, including automatic compaction and its retries. This requires a defined Pi runtime change; testing `AbortSignal` alone is insufficient.

3. **High — abort/shutdown release can accidentally authorize the gated action.**
   **Spec:** [design §1 Pause controller](/tmp/cm-prd-structured-roadmap-design-review/specs/5.safe-pause-resume/design.md:28), [design §2 tool/context hooks](/tmp/cm-prd-structured-roadmap-design-review/specs/5.safe-pause-resume/design.md:44), and [design Security](/tmp/cm-prd-structured-roadmap-design-review/specs/5.safe-pause-resume/design.md:125).
   **Trace:** A mutating tool is paused inside `tool_call` → reload emits `session_shutdown` without aborting the agent first ([AgentSession reload](/tmp/cm-prd-structured-roadmap-design-review/packages/coding-agent/src/core/agent-session.ts:2837)) → controller invalidates and resolves the deferred gate → awaited handler resumes and returns `undefined`.
   **Incorrect outcome:** The old tool or Provider request may start while the extension runtime is being replaced. Generation invalidation protects controller state but does not prevent the side effect.
   **Required correction:** Gate completion must be typed, such as `resumed | cancelled`. Only `resumed` may return from the hook normally. Abort, finish, reload, shutdown, stale generation, or session mismatch must block/throw before the tool or Provider action starts.

4. **High — the parallel-tool design has an admitted-but-not-observed race.**
   **Spec:** [design §2 parallel batches](/tmp/cm-prd-structured-roadmap-design-review/specs/5.safe-pause-resume/design.md:44).
   **Trace:** Tool A has successfully passed its awaited `tool_call` hook but its `tool_execution_start` has not yet updated the controller → `/pause` is accepted → Tool B reaches `tool_call`; the start-based in-flight set is empty, so the controller enters `paused` → already-admitted Tool A starts.
   **Incorrect outcome:** A tool starts while status says paused; resume can also release B before A has converged, violating F-003/AC-003.
   **Required correction:** Track a separate generation-bound admitted set from the successful `tool_call` decision through `tool_execution_end`. Enter `paused` only when both admitted and started sets for the pre-pause batch are empty. Do not rely solely on asynchronously observed start events.

5. **High — confirmation waiting is neither observable by PausePort nor command-reachable in the current TUI flow.**
   **Spec:** [design §3 Command contract](/tmp/cm-prd-structured-roadmap-design-review/specs/5.safe-pause-resume/design.md:57) and [design §4 Wait accounting](/tmp/cm-prd-structured-roadmap-design-review/specs/5.safe-pause-resume/design.md:70).
   **Trace:** A tool requests confirmation → Conversation’s presenter privately pauses `turnTiming` and awaits `ctx.ui.input` ([conversation extension](/tmp/cm-prd-structured-roadmap-design-review/packages/byz/src/conversation/conversation-extension.js:845)) → user types `/pause` into that modal. The text is consumed as a confirmation response and is not dispatched through `AgentSession.prompt()`; from another ingress, the pause command still has no shared confirmation-wait state to inspect.
   **Incorrect outcome:** F-010 cannot be implemented reliably: `/pause` may not execute, or it may create a second gate because confirmation state is private.
   **Required correction:** Introduce a shared generation-bound confirmation lease/state exposed read-only to PausePort and timing. The confirmation presenter must explicitly recognize `/pause`, report it unavailable, and continue the same confirmation—or Pi must provide command dispatch from modal input.

6. **Medium — registry facts are captured at request time, not at the actual paused boundary.**
   **Spec:** [design §1 controller snapshot](/tmp/cm-prd-structured-roadmap-design-review/specs/5.safe-pause-resume/design.md:28), [design interface](/tmp/cm-prd-structured-roadmap-design-review/specs/5.safe-pause-resume/design.md:95), and Feature 4’s [consumer contract](/tmp/cm-prd-structured-roadmap-design-review/specs/4.structured-execution-registry/design.md:115).
   **Trace:** Registry has active task A and two evidence receipts → an ordinary tool is running → `/pause` calls `request(liveTurn, registrySnapshot)` → the tool ends and Feature 4 records a third observed receipt → execution then reaches `paused`.
   **Incorrect outcome:** Pause status/receipt reflects pre-boundary facts. The proposed `PauseSnapshot` carries only plan/task IDs and cannot freeze evidence counts required by F-008.
   **Required correction:** Atomically sample the full bounded Feature 4 snapshot when the controller transitions to `paused`, after admitted tools converge. Keep that immutable boundary snapshot for status and receipt; do not mutate the registry.

7. **Medium — command failure has no specified rollback and can leave the next boundary armed.**
   **Spec:** [design §3 Command contract](/tmp/cm-prd-structured-roadmap-design-review/specs/5.safe-pause-resume/design.md:57) and [design §5 receipts](/tmp/cm-prd-structured-roadmap-design-review/specs/5.safe-pause-resume/design.md:89).
   **Trace:** `/pause` changes controller state to `requested` → appending the accepted receipt throws → the command rejects; Pi catches the extension command error and returns it as handled ([AgentSession command dispatch](/tmp/cm-prd-structured-roadmap-design-review/packages/coding-agent/src/core/agent-session.ts:1305)).
   **Incorrect outcome:** The user sees a failed command, but execution silently pauses later.
   **Required correction:** Define transactional ordering. Either make audit append best-effort so the accepted command does not fail, or catch every post-request failure and generation-bound cancel the request before returning failure.

8. **Medium — `/pause status` cannot represent required `running` state.**
   **Spec:** [design §3 status command](/tmp/cm-prd-structured-roadmap-design-review/specs/5.safe-pause-resume/design.md:57) and [design PauseSnapshot](/tmp/cm-prd-structured-roadmap-design-review/specs/5.safe-pause-resume/design.md:95).
   **Trace:** Agent is actively streaming with no pause request → controller snapshot state is `idle` because its union omits `running` → `/pause status` reads that snapshot.
   **Incorrect outcome:** Status reports `idle` for an active run, contrary to F-004.
   **Required correction:** Add `running` to the public snapshot or define a mandatory status projection combining controller state with the generation-bound live-turn identity.

Confirmed sound dependencies:

- Extension commands can execute while streaming because Pi dispatches them before the streaming queue branch ([AgentSession](/tmp/cm-prd-structured-roadmap-design-review/packages/coding-agent/src/core/agent-session.ts:1142)).
- `tool_call` is awaited before execution ([AgentSession](/tmp/cm-prd-structured-roadmap-design-review/packages/coding-agent/src/core/agent-session.ts:489)).
- Registering only `/pause` preserves Pi’s existing `/resume` command namespace.

findings: 8
unresolved: 8
verdict: `changes_required`
