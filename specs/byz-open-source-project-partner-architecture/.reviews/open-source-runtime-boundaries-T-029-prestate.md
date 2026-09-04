---
at: 2026-09-03T02:20:00-07:00
task: T-029
source_task: T-028
source_attempt: 2
branch: cm/runtime-boundary-p1--7a33ed19
base: 8bd3d7750859154b828819494534a75cccc04389
approval: user-blanket-explicit
---

# Pre-state

T-029 starts a new chain from frozen T-028. It retains independent preference cells but explicitly returns to BYZ's documented non-permission-sandbox boundary.

Scope is cooperative cross-process correctness, explicit same-field contention, pre-existing and observably changed path rejection, private/durable managed directories, bounded diagnostics, absent-parent first run and no modification of shared ancestors. It does not claim portable protection from arbitrary same-user Shell replacement between indivisible Node pathname calls.
