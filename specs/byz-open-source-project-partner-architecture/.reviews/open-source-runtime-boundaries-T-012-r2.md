---
at: 2026-08-30T10:33:19-07:00
reviewer: codex-cli
independent: true
task: T-012
attempt: 2
round: 2
verdict: blocked
blocking_findings: 5
handoff: open-source-runtime-boundaries-T-012-a2-handoff.json
handoff_sha256: 1ac61866298d5a166177e3867f0ac8e645c4b4e101e61b09346bd3235139ac16
scope:
  - packages/byz/scripts/build-support.mjs
  - packages/byz/test/build-safety.test.mjs
---

# Blocking findings

1. High: an expired owner can revive after its preemptor releases and removes the only preemption evidence.
2. High: publication remains check-operation-check; an old owner paused inside pointer promotion can overwrite a newer `current` before the post-check fails.
3. High: resolving the mutable output path before the active-lease map lookup can fall back to unleased publication after output-root replacement.
4. Medium: concurrent same-timestamp stale takeovers can elect zero winners; the test accepts and masks this outcome.
5. Medium: portable ancestor collisions such as `workflows/a` and `workflows/A/b` pass because portable keys are checked in original-spelling sort order.

TC-009: CONTRADICTED.

Round 2 is blocked. CM policy forbids attempt 3 without human resolution.
