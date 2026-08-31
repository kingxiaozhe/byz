---
at: 2026-08-30T20:09:40-07:00
reviewer: codex-cli
independent: true
task: T-017
attempt: 1
round: 1
verdict: changes_requested
blocking_findings: 3
handoff: open-source-runtime-boundaries-T-017-a1-handoff.json
handoff_sha256: f42e1a02d99c1985b0afd56f1355d1ae926021afaafa12d0ce9a05ce3debfc7a
scope:
  - packages/byz/.gitignore
  - packages/byz/build-manifest.json
  - packages/byz/package.json
  - packages/byz/scripts/build-support.mjs
  - packages/byz/scripts/build.mjs
  - packages/byz/test/build-safety.test.mjs
  - packages/byz/test/build.test.mjs
  - packages/byz/test/diagnostics.test.mjs
  - packages/byz/test/fast-switch.test.mjs
  - packages/byz/test/prewalk.test.mjs
  - packages/byz/test/smoke.test.mjs
  - packages/byz/test/update.test.mjs
  - packages/byz/test/workflow-switch.test.mjs
  - packages/byz/tsconfig.build.json
---

# Blocking findings

1. High: `packageMetadata` destinations are not checked against the portable compiled/runtime namespace and can overwrite compiled output, including through case aliases.
2. High: runtime assets, docs/examples and non-generated metadata are copied without rejecting source symlinks/non-regular entries, while image validation checks only existence.
3. Medium: cleanup accepts a resolvable but structurally invalid `current` target such as `.build-locks-v3` and may delete the failed candidate despite the contract requiring malformed current to preserve it.

TC-007: CONTRADICTED.
TC-008 (T-017 slice): CONTRADICTED.
TC-009 (T-017 slice): SUPPORTED.
TC-010: SUPPORTED.

Verdict: changes_requested.
