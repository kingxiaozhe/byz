---
at: 2026-09-02T21:13:00-07:00
task: T-025
source_task: T-023
source_attempt: 2
branch: cm/runtime-boundary-p1--7a33ed19
base: 8bd3d7750859154b828819494534a75cccc04389
approval: user-explicit
---

# Pre-state

T-025 starts a new task/review chain from the uncommitted T-023 attempt-2 implementation. T-023 is frozen after two blocked review rounds; no attempt 3 is permitted.

Inherited implementation scope:

- `packages/byz/scripts/check-architecture.mjs`
- `packages/byz/src/adapters/pi/pi-runtime-adapter.ts`
- `packages/byz/src/application/ports/runtime.ts`
- `packages/byz/src/fast-session.js`
- `packages/byz/src/prewalk.js`
- focused architecture/Fast/Prewalk tests

T-025 may change only the architecture checker and architecture regressions unless a failing focused test proves a necessary adjustment in the inherited runtime scope. Existing P1 specs/status/log changes predate T-025 and remain separate from product implementation accounting.
