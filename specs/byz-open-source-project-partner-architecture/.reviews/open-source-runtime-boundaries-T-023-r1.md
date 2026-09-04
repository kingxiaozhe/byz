---
at: 2026-09-02T20:39:00-07:00
reviewer: codex-cli
independent: true
task: T-023
attempt: 1
round: 1
verdict: changes_requested
blocking_findings: 2
handoff: open-source-runtime-boundaries-T-023-a1-handoff.json
handoff_sha256: e2709dd88d8d6723e9ff3af00e2d979a109ca28280f111116259c7c0006dd800
scope:
  - packages/byz/scripts/check-architecture.mjs
  - packages/byz/src/adapters/pi/pi-runtime-adapter.ts
  - packages/byz/src/application/ports/runtime.ts
  - packages/byz/src/fast-session.js
  - packages/byz/src/prewalk.js
  - packages/byz/test/architecture.test.mjs
  - packages/byz/test/fast-switch.test.mjs
  - packages/byz/test/prewalk.test.mjs
---

# Findings

1. **P1 — Reject feature aliases stored in containers.** With all canonical calls present, `const bag = { mount: conversationExtension }; bag.mount(pi)` produces no violation and leaves the composition count at one. The property-access symbol lookup does not connect `bag.mount` to its initializer, so object, shorthand, destructuring, array, helper, and bind aliases can still route raw Pi into a feature.
2. **P1 — Reject raw facade properties assigned after creation.** Adapter code such as `const facade = {}; facade.raw = pi; return facade` produces no raw-escape violation because the gate checks declarations/object members but not statically named member assignments or equivalent static property definition.

The runtime lineage and Prewalk trust-race changes address their targeted scenarios, but these two architecture-gate bypasses directly contradict the task boundary.

## Logic-case disposition

- TC-002: `CONTRADICTED` — the static boundary still accepts container aliases and post-creation raw writes.
- TC-003: `SUPPORTED` — no managed-resource capability contract was expanded by the task diff.
- TC-015: `CONTRADICTED` — a feature can still receive raw Pi through a stored alias.
- TC-016: `CONTRADICTED` — the new negative matrix does not cover the reproduced container and post-creation assignment escapes.

## Reviewer environment note

The isolated worktree lacked the current generated model state used by the main workspace, so a broad type probe reported baseline model-literal errors. The reviewer did not use those errors as a task finding; the author's current-workspace `npm run check` passed.
