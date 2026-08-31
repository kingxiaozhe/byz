---
at: 2026-08-30T09:00:11-07:00
reviewer: codex-cli
independent: true
task: T-002
attempt: 2
round: 2
verdict: blocked
blocking_findings: 6
handoff: open-source-runtime-boundaries-T-002-a2-handoff.json
handoff_sha256: dc001bdfa6549ca5cabea70d186f8cb78db0334797ef0be1cb206b10080e6a6b
scope:
  - .github/workflows/byz-release.yml
  - packages/byz/.gitignore
  - packages/byz/build-manifest.json
  - packages/byz/package.json
  - packages/byz/scripts/build-support.mjs
  - packages/byz/scripts/build.mjs
  - packages/byz/scripts/pack.mjs
  - packages/byz/test/build.test.mjs
  - packages/byz/test/diagnostics.test.mjs
  - packages/byz/test/fast-switch.test.mjs
  - packages/byz/test/prewalk.test.mjs
  - packages/byz/test/smoke.test.mjs
  - packages/byz/test/update.test.mjs
  - packages/byz/test/workflow-switch.test.mjs
  - packages/byz/tsconfig.build.json
  - scripts/byz-packed-runtime.test.mjs
  - scripts/byz-release.test.mjs
---

# Blocking findings

1. High: `.byz-output` itself can be a symlink, allowing lock cleanup and generation writes outside the package boundary.
2. High: source-workspace `bin`, `main`, and exports still point to `dist`, while the build only updates `.byz-output/current/dist`.
3. Medium: duplicate, root, or nested workflow bundle destinations can overlap and merge nondeterministically.
4. Medium: PID-only stale-lock identity can misclassify a reused PID as the original active build indefinitely.
5. Medium: `scripts/byz-release.mjs` dry-run still packs the obsolete package root rather than the validated current image.
6. Medium: tests do not invoke the production build with a real added BYZ source module or cover the identified production safety boundaries.

Static cases: TC-007 SUPPORTED; TC-008 CONTRADICTED.

Round 2 is blocked. CM policy forbids attempt 3 without human resolution.
