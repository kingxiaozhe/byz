---
at: 2026-09-02T22:05:00-07:00
task: T-005
branch: cm/runtime-boundary-p1--7a33ed19
base: 8bd3d7750859154b828819494534a75cccc04389
approval: approved-specs
predecessor: T-026
---

# Pre-state

T-005 starts after T-026 passed independent review. The worktree contains the approved but uncommitted Runtime Boundary implementation and evidence from T-023 through T-026; those changes are inherited and must not be reverted.

T-005 is limited to a Command Registry, structured `CommandResult`, bootstrap composition, one-time BYZ option parsing, unified output/exit mapping, and regressions for update, workflow, diagnostics, Fast and Pi passthrough behavior.
