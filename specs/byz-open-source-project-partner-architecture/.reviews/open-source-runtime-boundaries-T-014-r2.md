---
at: 2026-08-30T21:30:29-07:00
reviewer: codex-cli
independent: true
task: T-014
attempt: 2
round: 2
verdict: blocked
blocking_findings: 3
handoff: open-source-runtime-boundaries-T-014-a2-handoff.json
handoff_sha256: 0f8a9127418148da5e02e14ef68af84154804e52bfd8dcd9bee73d6dc7021755
scope:
  - .github/workflows/byz-release.yml
  - packages/byz/scripts/build.mjs
  - packages/byz/scripts/pack.mjs
  - scripts/byz-packed-runtime.test.mjs
  - scripts/byz-release.mjs
  - scripts/byz-release.test.mjs
---

# Blocking findings

1. High: CI smoke extracts, installs, and executes the mutable tarball pathname before the private snapshot boundary, so byte identity is not preserved from pack through smoke and publish.
2. High: validation limits compressed input size but does not enforce expected per-file and total uncompressed sizes before extraction; a small high-expansion tarball can exhaust disk or memory before byte comparison.
3. Medium: pack validates a destination realpath but passes the original caller pathname to npm; a destination symlink can be retargeted between check and use to mutate `.byz-output/current`.

The round-1 deterministic metadata and publish-time caller-path replacement findings are otherwise closed.

TC-008 (T-014 slice): CONTRADICTED.

Round 2 is blocked. CM policy forbids attempt 3 without human resolution.
