---
at: 2026-09-02T23:47:00-07:00
task: T-027
source_task: T-005
source_attempt: 2
branch: cm/runtime-boundary-p1--7a33ed19
base: 8bd3d7750859154b828819494534a75cccc04389
approval: user-blanket-explicit
---

# Pre-state

T-027 starts a new task/review chain from T-005 attempt 2. T-005 is frozen after two review rounds and must not receive attempt 3.

T-027 is limited to a bounded update-output overflow termination protocol, kill failure/error and missing-close behavior, prior-step output accumulation, and direct regressions. All accepted Command Registry and T-026 behavior remains regression scope.
