---
at: 2026-09-03T00:48:00-07:00
task: T-007
branch: cm/runtime-boundary-p1--7a33ed19
base: 8bd3d7750859154b828819494534a75cccc04389
approval: approved-specs-and-blanket
predecessor: T-006
---

# Pre-state

T-007 starts after T-006 passed its final independent review. It replaces the controller's synchronous best-effort JSON preference helpers with a dedicated schema-validated repository.

Scope: private permissions, atomic writes, corrupt-file quarantine with diagnostic state, cross-process lock-and-reread merge, language/detail migration and focused concurrent-process regressions.
