---
at: 2026-09-01T20:50:28-07:00
reviewer: codex-cli
independent: true
task: T-013
attempt: 1
round: 1
verdict: changes_requested
blocking_findings: 1
handoff: trusted-cm-recovery-card-T-013-a1-handoff.json
handoff_sha256: d33a97a0e6aeda75aa28d521156a2017c5401c9f27e8312055e4e987477825e3
scope:
  - packages/byz/src/recovery/cm-evidence-reader.js
  - packages/byz/src/recovery/recovery-state.js
  - packages/byz/test/recovery-reader.test.mjs
  - packages/byz/test/recovery-state.test.mjs
---

## Finding

- **P2 — matching review symlink/non-file loses its source path.** A matching review directory entry that is a symlink or non-file returns `unsafe_path` without `relativePath`; aggregation then emits an issue whose path is `undefined`, violating the bounded project-relative issue contract and preventing T-014 from showing the failing source.

## Logic-case verdicts

- TC-011: `SUPPORTED`
- TC-012: `SUPPORTED`

## Verdict

`changes_requested`. Add the exact matching review entry path before aggregating the failure and cover it with a regression test.
