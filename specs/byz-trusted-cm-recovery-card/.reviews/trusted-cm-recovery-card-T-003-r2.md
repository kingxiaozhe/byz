---
at: 2026-08-31T20:26:30-07:00
reviewer: codex-cli
independent: true
task: T-003
attempt: 2
round: 2
verdict: blocked
blocking_findings: 2
handoff: trusted-cm-recovery-card-T-003-a2-handoff.json
handoff_sha256: 2c614682044aedbe9840a550cffd3ea1e720ef5f07fb22c1472b297519887f01
scope:
  - packages/byz/src/recovery/safe-read.js
  - packages/byz/src/recovery/cm-evidence-reader.js
  - packages/byz/test/recovery-reader.test.mjs
---

# Findings

1. **High — TC-004 regression coverage is incomplete.** The suite mutates project identity but does not independently exercise specs-directory and leaf-file identity replacement. Non-regular leaf and platform-available junction variants are also not covered.
2. **Medium — TC-003 candidate lifecycle coverage is incomplete.** The suite covers running candidates but not done + awaiting_review, paused/blocked and done-resolved selection.

The attempt-1 review-body finding is fixed: full review size is checked before reading, physical reads stop at 32 KiB, and only projected frontmatter bytes enter the receipt.

## Contract results

- TC-002: **SUPPORTED** for the T-003 trust-first boundary.
- TC-003: **CONTRADICTED** by incomplete lifecycle regression coverage.
- TC-004: **CONTRADICTED** by incomplete identity and file-type regression coverage.

Per the two-round limit, T-003 cannot create attempt 3. A newly approved tests-only replacement task is required.

verdict: blocked
