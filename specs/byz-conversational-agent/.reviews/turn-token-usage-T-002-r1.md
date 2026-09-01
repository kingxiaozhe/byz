---
at: 2026-09-01T02:02:00-07:00
reviewer: codex-cli
independent: true
task: T-002
attempt: 1
round: 1
verdict: changes_requested
blocking_findings: 2
handoff: turn-token-usage-T-002-a1-handoff.json
handoff_sha256: b23c327583598bce633a1a6aad336d2c4c9ebb6b75961f3d35a74521d215d72b
scope:
  - packages/byz/src/adapters/pi/pi-runtime-adapter.ts
  - packages/byz/src/conversation/conversation-extension.js
  - packages/byz/test/architecture.test.mjs
  - packages/byz/test/conversation.test.mjs
---

# Findings

1. **High — missing Provider usage becomes observed zero.** Pi initializes mandatory usage fields to zero. A final all-zero message is currently projected and displayed as `↑0 · ↓0` instead of unavailable.
2. **Medium — the adapter test fabricates a terminal `message_update`.** Agent loop emits `done/error` as `message_end`; the test does not prove a reachable usage-bearing partial update.

## Contract results

- TC-001: **CONTRADICTED**
- TC-002: **INSUFFICIENT_EVIDENCE**
- TC-003: **CONTRADICTED**
- TC-004: **INSUFFICIENT_EVIDENCE** (runtime cancellation/error evidence remains assigned to T-003)

verdict: changes_requested
