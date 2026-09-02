---
at: 2026-09-01T21:48:46-07:00
reviewer: codex-cli
independent: true
task: T-016
attempt: 1
round: 1
verdict: changes_requested
blocking_findings: 1
handoff: trusted-cm-recovery-card-T-016-a1-handoff.json
handoff_sha256: 55327ecf506a47243ac126aed717edc37b838903f2e4adeb6a86780b6dc835fe
scope:
  - packages/byz/src/recovery/cm-evidence-reader.js
  - packages/byz/src/recovery/recovery-state.js
  - packages/byz/test/recovery-reader.test.mjs
  - packages/byz/test/recovery-state.test.mjs
---

# Finding

- **P1 — candidate direct-child boundary rejection loses its source path.** If an injected/canonicalized candidate resolves inside `specs` but not as a direct child, the rejection branch emits `unsafe_path` without `relativePath`; issue aggregation serializes a pathless issue. Return the requested project-relative candidate path and add a regression.

# Logic cases

- TC-011: **SUPPORTED**
- TC-012: **CONTRADICTED** by the pathless candidate-boundary branch

verdict: changes_requested
