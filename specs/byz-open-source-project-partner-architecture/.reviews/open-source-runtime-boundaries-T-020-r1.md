---
at: 2026-08-31T00:08:00-07:00
reviewer: codex-cli
independent: true
task: T-020
attempt: 1
round: 1
verdict: changes_requested
blocking_findings: 1
handoff: open-source-runtime-boundaries-T-020-a1-handoff.json
handoff_sha256: 60609951bf37e50b2104cca9f3bd0e0c1945d605638f70d056af8f61a498ff99
scope:
  - .github/workflows/byz-release.yml
  - scripts/byz-release.mjs
  - scripts/byz-release.test.mjs
---

# Blocking finding

1. High: dry-run exports generation identity and SHA-256, but smoke verification and publish do not consume those expected values. If both tarball and receipt paths are replaced with a self-consistent artifact B, downstream verification accepts B instead of proving it is dry-run artifact A. Existing replacement coverage changes only the tarball while retaining receipt A, and workflow assertions prove the identity variables are written but not enforced.

TC-008: CONTRADICTED.
TC-012: CONTRADICTED.
TC-013: CONTRADICTED.

Verdict: changes_requested. Attempt 2 must require the expected dry-run generation and SHA at smoke, post-smoke, and publish, and execute paired tarball+receipt replacement regressions.
