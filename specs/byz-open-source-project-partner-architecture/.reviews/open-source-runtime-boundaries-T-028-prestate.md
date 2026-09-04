---
at: 2026-09-03T01:25:00-07:00
task: T-028
source_task: T-007
source_attempt: 2
branch: cm/runtime-boundary-p1--7a33ed19
base: 8bd3d7750859154b828819494534a75cccc04389
approval: user-blanket-explicit
---

# Pre-state

T-028 starts a new task/review chain; T-007 is frozen after two blocked rounds.

The replacement removes the shared persistent lock entirely. Language and detail mode use independent versioned atomic cells, so cross-field updates have no common destination to overwrite. It retains descriptor-bounded reads, forensic corrupt copies, strict schema, legacy migration, private permissions and visible diagnostics while closing directory and pathname boundaries.
