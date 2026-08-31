---
at: 2026-08-30T21:17:14-07:00
reviewer: codex-cli
independent: true
task: T-014
attempt: 1
round: 1
verdict: changes_requested
blocking_findings: 3
handoff: open-source-runtime-boundaries-T-014-a1-handoff.json
handoff_sha256: 9c631c9df57e1c62ef149b7ca2b9bf63d67ddd0941fa48a6668cc026dc2865bb
scope:
  - .github/workflows/byz-release.yml
  - packages/byz/scripts/build.mjs
  - packages/byz/scripts/pack.mjs
  - scripts/byz-packed-runtime.test.mjs
  - scripts/byz-release.mjs
  - scripts/byz-release.test.mjs
---

# Blocking findings

1. High: current-image revalidation checks selected protected fields and safe targets but does not require exact equality with `createPublishedPackageJson(workspacePackageJson)`, so added install scripts, `publishConfig`, changed bin names, or redirected existing entry files can pass.
2. High: publish validates the caller's tarball path and later reopens the same mutable path for `npm publish`; replacement or symlink retargeting between validation and publish can substitute bytes.
3. Medium: `--pack-destination` can resolve inside `.byz-output/current`, allowing npm to mutate the immutable package image after validation.

TC-008 (T-014 slice): CONTRADICTED.

Verdict: changes_requested.
