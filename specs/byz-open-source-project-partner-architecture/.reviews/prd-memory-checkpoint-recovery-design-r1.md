---
at: 2026-08-30T07:50:37-07:00
reviewer: codex-cli
independent: true
scope:
  - specs/byz-open-source-project-partner-architecture/3.memory-checkpoint-recovery/requirements.md
  - specs/byz-open-source-project-partner-architecture/3.memory-checkpoint-recovery/design.md
  - packages/coding-agent/src/core/extensions/types.ts
---

# Design review findings

1. **High — startup assessment could mutate state and falsely interrupt a live concurrent Operation.** Keep assessment pure; mark interruption only after lease/liveness proof and CAS.
2. **High — current Pi lifecycle lacks a stable completion outcome.** Add a product-neutral settled result with stable runId and completed/aborted/failed/retrying outcomes.
3. **High — checkpoint baseline was opaque and incomplete.** Persist taskVersion, structured branch/HEAD/status digest, decision IDs, and typed pending items.
4. **High — global memory had no independent storage boundary.** Add a separately migrated private global-memory repository; project databases retain scoped references only.

Disposition: all four findings accepted and applied to requirements/design.
