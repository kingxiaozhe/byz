---
reviewer: codex-cli
independent: true
at: 2026-09-01T08:12:23Z
scope:
  - specs/byz-conversational-agent/3.turn-token-usage/requirements.md
  - specs/byz-conversational-agent/3.turn-token-usage/design.md
  - specs/byz-conversational-agent/3.turn-token-usage/tasks.md
  - specs/byz-conversational-agent/3.turn-token-usage/test-cases.json
---

# Findings

1. **High — Aggregation can convert unavailable fields into observed zero.** `design.md:40-42,56` makes the `agent_end` aggregate authoritative but does not require per-field presence tracking. A conventional zero-initialized aggregate would turn an output-only response into `input: 0`, `cacheRead: 0`, and `cacheWrite: 0`, violating AC-004/006. `TC-003` does not explicitly require a partial-field `agent_end` aggregate to preserve unavailable fields.

2. **Medium — Safe individual fields can overflow during turn aggregation.** `design.md:34` validates each projected field, but neither Adapter aggregation nor the turn accumulator defines checked addition. Multiple individually valid values can exceed `Number.MAX_SAFE_INTEGER`, producing an unsafe rounded total that reaches progress and completion output. `TC-003` covers only an individually oversized field, not cumulative overflow.

3. **Medium — Cancellation and exception cleanup rely on an unstated lifecycle guarantee.** `design.md:52-57` defines cleanup only through `agent_end` and `session_shutdown`, while AC-008 separately requires cancellation and exception cleanup. `TC-004:53-54` mentions those paths but its expected result only asserts “end or shutdown,” so a test could simulate cancellation by manually sending `agent_end` and miss a real error path that leaves the interval and usage accumulator active.

verdict: changes_requested
