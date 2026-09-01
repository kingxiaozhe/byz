---
at: 2026-09-01T05:07:00-07:00
reviewer: codex-cli
independent: true
feature: 3.turn-token-usage
qa_verdict: failed
blocking_findings: 1
scope:
  - specs/byz-conversational-agent/3.turn-token-usage/requirements.md
  - specs/byz-conversational-agent/3.turn-token-usage/design.md
  - specs/byz-conversational-agent/3.turn-token-usage/test-cases.json
  - packages/byz/src/adapters/pi/pi-runtime-adapter.ts
  - packages/byz/src/conversation/conversation-extension.js
  - packages/byz/test/conversation.test.mjs
  - packages/byz/test/architecture.test.mjs
  - scripts/byz-packed-runtime.test.mjs
---

# Turn Token Usage — N6 QA

## Finding

1. **High — standalone all-zero usage is not preserved as observed zero.**

   The Adapter accepts safe zero fields, but intentionally drops the complete projection unless at least one field is positive. The same gate applies to `agent_end` aggregation. Therefore an all-zero payload or a lone `{ cacheWrite: 0 }` renders unavailable, while zero siblings are retained only when another positive field proves that the payload is observed.

   This behavior protects against Pi/Provider mandatory all-zero initialization, but the approved AC-004 and field-presence design do not state that exception. Literal compliance is therefore unresolved: the runtime cannot distinguish a mandatory unavailable all-zero placeholder from a genuinely observed all-zero payload without another presence signal.

## Test cases

| Test case | Result | Evidence |
| --- | --- | --- |
| TC-001 | PASS | Focused unknown/history/first-response/tool-retention test and 80×24 captures. |
| TC-002 | PASS | Streaming snapshot replacement, two-response exact accumulation, and aggregate override tests. |
| TC-003 | PASS | Partial, invalid, and checked-overflow tests. |
| TC-004 | PASS | Real normal/error/abort/post-abort `AgentSession` runs, timer/faux/network/storage invariance, and cleanup mutation. |
| TC-005 | PASS | 80×24 isolated faux TUI plus non-interactive and packed-runtime evidence. |

The generated test contracts omit a standalone all-zero projection case, so 5/5 TC PASS does not close the AC-004 ambiguity.

## Acceptance criteria

- AC-001: PASS — unknown turn starts at `Token —` without Session history.
- AC-002: PASS — first observed response updates input/output and tools retain it.
- AC-003: PASS — snapshot replacement and response commits deduplicate exactly.
- AC-004: FAIL — mixed positive/zero is covered, but standalone all-zero collapses to unavailable.
- AC-005: PASS — Footer remains Session-scoped and Thinking layout is unchanged.
- AC-006: PASS — missing/partial fields remain unavailable or omitted.
- AC-007: PASS — invalid and overflow fields fail closed.
- AC-008: PASS — real normal/error/abort cleanup and shutdown/new-turn reset pass.
- AC-009: PASS — no extra timer, network, model, storage, or diagnostics side effects.
- AC-010: PASS — 80-column TUI and non-interactive commands pass.

## Regression summary

- Focused Conversation: 18/18 passed.
- BYZ package: 204 passed, 1 platform skip.
- Packed runtime: 2/2 passed.
- `npm run check`: passed.
- `./test.sh`: passed.
- T-001, T-002, T-003 final task reviews: approved.
- Recovery current-screen dependency review: approved.

## Verdict

`qa_verdict: failed`

One product/spec decision is required before automatic correction: either define mandatory all-zero as unavailable, treat terminal all-zero as observed despite false-zero risk, or add an upstream presence signal.
