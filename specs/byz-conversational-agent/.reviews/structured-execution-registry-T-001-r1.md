---
at: 2026-09-02T03:34:00-07:00
reviewer: self-degraded
independent: false
degraded_reason: isolated codex-cli review read the task package but timed out before returning a final review artifact
attempt: 1
round: 1
task: T-001
verdict: changes_requested
blocking_findings: 5
handoff: structured-execution-registry-T-001-a1-handoff.json
handoff_sha256: 8fcaa1fd78813599c5e9faadd4f026f54a8c8a857d07686c3f9717c0473d1fec
scope:
  - packages/byz/test/architecture.test.mjs
  - packages/byz/test/conversation.test.mjs
  - packages/byz/test/execution-extension.test.mjs
  - packages/byz/test/execution-registry.test.mjs
---

# Findings

1. **P1 — Plan identity uniqueness is not tested.** `execution-registry.test.mjs` uses incrementing IDs but never opens a second generation in the same registry and asserts a distinct host-generated `planId`. A reducer could reuse one ID for every generation and still pass, contradicting F-002. Add a sequential/new-generation assertion.
2. **P1 — New tests use fixed sleeps.** Both new Conversation cases wait five milliseconds, violating the repository rule that async tests use an event or promise boundary rather than fixed sleep. Replace them with deterministic timer/event completion.
3. **P1 — Trusted verification remains forgeable under the tests.** The positive verifier checks source/testCase/outcome, while the registry tests do not require a valid task, bounded test-case ID, closed fields, or exact generation binding before invoking it. An implementation that forwards an extra payload or unknown task can pass. Add malformed task/testCase/extra-field cases.
4. **P2 — The 128-receipt boundary is untested.** T-001 claims bounded receipts, but no test reaches the limit and asserts receipt 129 is rejected without changing counts or exposing raw data.
5. **P2 — Compact safety is tested only for an unavailable malicious snapshot.** The available sealed snapshot contains no unexpected label/path fields, so a renderer that leaks those fields when progress is otherwise valid can pass. Put malicious ignored fields on a valid snapshot and assert absence.

# Test-contract static adjudication

- TC-001: SUPPORTED — atomic open/seal, ordinal, legal/illegal transitions, and Conversation red output are asserted.
- TC-002: SUPPORTED — empty/65/duplicate/malformed tasks, replay gaps/conflicting duplicates, and fail-closed recovery are represented.
- TC-003: INSUFFICIENT_EVIDENCE — provenance layers exist, but trusted-receipt schema/binding is not closed enough.
- TC-005: SUPPORTED — parallel start, out-of-order end, duplicate end, unknown end, and active-task binding are asserted.
- TC-006: INSUFFICIENT_EVIDENCE — zero/drafting/unavailable behavior is represented, but malicious fields on a valid snapshot are not.

verdict: changes_requested
blocking_findings: 5
