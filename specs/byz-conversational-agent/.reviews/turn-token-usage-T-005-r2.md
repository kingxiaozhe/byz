---
at: 2026-09-02T01:07:22-07:00
reviewer: codex-cli
independent: true
task: T-005
attempt: 2
round: 2
verdict: blocked
blocking_findings: 1
handoff: turn-token-usage-T-005-a2-handoff.json
handoff_sha256: ac7445835f81df7d1bf5bda91f50a07bd886ae672546a775463e4c63fa7b20dd
scope:
  - packages/byz/src/conversation/conversation-extension.js
  - packages/byz/test/conversation.test.mjs
---

# Findings

1. **High — generation binding is incomplete for interval and confirmation continuations.** A queued Turn A interval callback can invoke shared `publishWorking` after Turn B starts. More importantly, Turn A can remain suspended in the asynchronous confirmation presenter, end or abort, then resolve after Turn B starts; its `finally` calls `resumeAfterConfirmation()` and `publishWorking()` against Turn B, potentially ending Turn B's own waiting interval and corrupting active/waiting accounting. The timeout callback is generation-bound, but these other delayed continuations are not.

The parallel-tool failure ordering finding from round 1 is fixed and covered: an assistant update while another tool is active no longer clears the earlier matched failure, and the selector enters recover after the last success.

# Contract results

- TC-001: `SUPPORTED`
- TC-002: `SUPPORTED`
- TC-003: `SUPPORTED`
- TC-004: `CONTRADICTED`
- TC-006: `SUPPORTED`
- TC-007: `CONTRADICTED`
- TC-008: `SUPPORTED`

Verdict: `blocked`. T-005 has reached the two-round limit; no attempt 3 is permitted.
