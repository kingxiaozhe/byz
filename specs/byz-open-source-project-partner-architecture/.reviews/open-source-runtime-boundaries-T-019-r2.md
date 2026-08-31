---
at: 2026-08-30T23:05:12-07:00
reviewer: codex-cli
independent: true
task: T-019
attempt: 2
round: 2
verdict: blocked
blocking_findings: 1
handoff: open-source-runtime-boundaries-T-019-a2-handoff.json
handoff_sha256: d5221df5f89aea04ad5cf280ef4deb38095fcb898a4a7db49fd8604524240374
scope:
  - .github/workflows/byz-release.yml
  - packages/byz/scripts/artifact.mjs
  - packages/byz/scripts/build.mjs
  - packages/byz/scripts/pack.mjs
  - packages/byz/scripts/verify-artifact.mjs
  - scripts/byz-packed-runtime.test.mjs
  - scripts/byz-release.mjs
  - scripts/byz-release.test.mjs
---

# Blocking finding

1. High: release dry-run still creates artifact A independently, while CI later invokes `pack.mjs` again to create artifact B and only B reaches smoke/publish. A and B can bind different generations and bytes. Dry-run packing also lacks a process-identity lock and final current/receipt revalidation, and the regression explicitly accepts switching current between these independent packs.

The other five round-1 findings are closed: complete npm-manifest comparison, bounded descriptor capture, recomputed SHA-256/SHA-512, pre/post publish ownership checks and false-release failure, strict tar grammar, canonical private destination use, and executable race tests are present.

TC-008 (T-019 slice): CONTRADICTED.
TC-012: SUPPORTED.

Round 2 is blocked. CM policy forbids attempt 3 without human resolution.
