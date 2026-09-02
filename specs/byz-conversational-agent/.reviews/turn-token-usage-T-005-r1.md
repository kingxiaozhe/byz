---
at: 2026-09-02T00:57:55-07:00
reviewer: codex-cli
independent: true
task: T-005
attempt: 1
round: 1
verdict: changes_requested
blocking_findings: 2
handoff: turn-token-usage-T-005-a1-handoff.json
handoff_sha256: 192bae058f35e617e6c15a7aff19ed9669d3a73ea5844c6a5f85a4fbce380580
scope:
  - packages/byz/src/conversation/conversation-extension.js
  - packages/byz/test/conversation.test.mjs
---

# Findings

1. **High — an old queued timeout can reveal a newer turn.** Turn A ends before its delay, Turn B starts, then A's already-queued callback executes and mutates the shared current progress state because no generation token is checked.
2. **High — assistant update can clear a prior parallel-tool error too early.** A and B run, A fails, assistant update arrives while B remains, then B succeeds; the update clears `recoverPending`, so the post-tool status loses A's failure based on event order.

# Contract results

- TC-001: `SUPPORTED`
- TC-002: `SUPPORTED`
- TC-003: `SUPPORTED`
- TC-004: `CONTRADICTED`
- TC-006: `CONTRADICTED`
- TC-007: `SUPPORTED`
- TC-008: `SUPPORTED`

Mandatory all-zero remains governed by the bounded Adapter contract and is not a finding.

Verdict: `changes_requested`.
