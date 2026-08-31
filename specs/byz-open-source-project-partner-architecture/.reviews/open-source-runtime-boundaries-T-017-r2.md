---
at: 2026-08-30T20:23:41-07:00
reviewer: codex-cli
independent: true
task: T-017
attempt: 2
round: 2
verdict: blocked
blocking_findings: 2
handoff: open-source-runtime-boundaries-T-017-a2-handoff.json
handoff_sha256: 019fa3a30b50ca8816542f03ee3f904f075ed433866216468d6fd40f59c7f3c9
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

1. High: portable path overlap detection compares only adjacent sorted keys. `A.js`, `a.js-foo.js`, and `a.js/b.js` can place an unrelated key between an ancestor and descendant, allowing a non-portable file/directory alias through manifest and compiled-output validation.
2. High: pre-lock regular-tree validation does not scan the BYZ `src` tree. TypeScript can follow a pre-existing source symlink to an external JavaScript file and emit a regular compiled file, so later output/image validation loses the external provenance.

The three round-1 findings are otherwise closed, and no T-016 ownership regression was found.

TC-007: SUPPORTED.
TC-008 (T-017 slice): SUPPORTED.
TC-009 (T-017 slice): SUPPORTED.
TC-010: CONTRADICTED.

Round 2 is blocked. CM policy forbids attempt 3 without human resolution.
