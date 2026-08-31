---
at: 2026-08-30T17:47:11-07:00
reviewer: codex-cli
independent: true
task: T-013
attempt: 1
round: 1
verdict: changes_requested
blocking_findings: 4
handoff: open-source-runtime-boundaries-T-013-a1-handoff.json
handoff_sha256: f32ddd6441273f98466ab5bce4cfe9848a83e2b34ba96399feb9e16539615207
scope:
  - packages/byz/package.json
  - packages/byz/scripts/build.mjs
  - packages/byz/test/build.test.mjs
---

# Findings

1. High: bundled workflow trees are copied without rejecting internal symlinks that escape the locked package.
2. High: Pi runtime copy can overwrite compiled BYZ output under the reserved `dist/runtime` namespace.
3. Medium: an injected nonstandard output directory can report success while workspace metadata still points at `.byz-output/current`.
4. Medium: package entry transformation accepts safe paths outside the required image-local `dist/**` tree.

TC-007: CONTRADICTED.
TC-008 (T-013 slice): CONTRADICTED.
TC-009 (T-013 slice): SUPPORTED.

Verdict: changes_requested.
