---
at: 2026-09-02T04:47:00-07:00
reviewer: codex-cli
independent: true
attempt: 2
round: 2
task: T-002
verdict: blocked
blocking_findings: 1
handoff: structured-execution-registry-T-002-a2-handoff.json
handoff_sha256: 41d9bf6829d7e73870c516870d0e20b80b8f8811a49bfffb125c1309fe417cd7
scope:
  - packages/byz/src/execution/execution-registry.js
  - packages/byz/src/execution/execution-schema.js
  - packages/byz/test/execution-registry.test.mjs
---

# Finding

1. **P1 — A hostile maximum sequence permanently poisons recovery.** An invalid Session receipt with `sequence: Number.MAX_SAFE_INTEGER` sets the unavailable state's sequence to that rejected value. The next explicit `plan_open` constructs an unsafe sequence and cannot append, so the user cannot start a new generation as required by F-009/TC-002. Recovery must advance from the last accepted sequence, not an unaccepted hostile record, and replay must permit the later valid generation.

# Test-contract static adjudication

- TC-001: SUPPORTED
- TC-002: CONTRADICTED
- TC-004: SUPPORTED
- TC-008: SUPPORTED

verdict: blocked
blocking_findings: 1
