---
at: 2026-08-30T11:03:52-07:00
reviewer: codex-cli
independent: true
task: T-015
attempt: 1
round: 1
verdict: changes_requested
blocking_findings: 6
handoff: open-source-runtime-boundaries-T-015-a1-handoff.json
handoff_sha256: e2bab8c1c0e9709c9b91c98ecaae15378f1cac4bcb7db0b9df07e7db91f8da46
scope:
  - packages/byz/scripts/build-support.mjs
  - packages/byz/test/build-safety.test.mjs
---

# Findings

1. High: a delayed stale observer can move a newer live global lock before detecting the token mismatch.
2. High: package-image publication still has an unlocked fallback.
3. High: a symlinked `generations` descendant is not rejected before build writes.
4. High: macOS `ps lstart` identity is environment-sensitive and only second-granular.
5. Medium: lowercase is not full Unicode case folding, and Windows reserved names are checked before NFKC normalization.
6. Medium: the PID-reuse test retains an `absent` override and does not exercise `different`.

TC-009: CONTRADICTED.

Disposition: accepted for attempt 2. The global movable lock will be replaced by immutable owner directories with claiming/active election; publication will require an active lock; the generations root will be created and identity-checked by lock acquisition; macOS probe output will be locale/timezone pinned and conservative; workflow names will use an ASCII portable subset; the PID-reuse branch will clear the absence override.
