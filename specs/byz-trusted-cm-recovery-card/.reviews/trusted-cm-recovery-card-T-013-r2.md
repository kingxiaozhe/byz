---
at: 2026-09-01T20:58:40-07:00
reviewer: codex-cli
independent: true
task: T-013
attempt: 2
round: 2
verdict: blocked
blocking_findings: 1
handoff: trusted-cm-recovery-card-T-013-a2-handoff.json
handoff_sha256: 8c706ada44ca6c8f29f9cc8154f2c16385e2cc4d94899ab7b7ea9727a84c3801
scope:
  - packages/byz/src/recovery/cm-evidence-reader.js
  - packages/byz/src/recovery/recovery-state.js
  - packages/byz/test/recovery-reader.test.mjs
  - packages/byz/test/recovery-state.test.mjs
---

## Finding

- **P1 — legacy terminal alias can hide multiple unfinished tasks.** With `run.status: done`, manifest `schema_version: 1`, status `task: null` and `state: completed`, plus two unchecked canonical tasks, `currentTask` remains undefined. The actionable predicate checks only `currentTaskRecord`, returns false, and the candidate becomes `absent`. This violates AC-024: unresolved tasks mean the candidate is not proven terminal and must not be silently ignored.

## Reproduction

The independent reviewer constructed a candidate with two incomplete tasks and observed:

```text
{ state: 'absent' }
```

Expected: actionable conflict/unavailable; never silent absence.

## Logic-case verdicts

- TC-011: `SUPPORTED`
- TC-012: `INSUFFICIENT_EVIDENCE` for the multiple-incomplete-task terminal branch

## Verdict

`blocked`. Round 2 cannot create attempt 3. A separately approved replacement task must add the missing regression and minimal actionable-state fix.
