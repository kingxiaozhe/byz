---
at: 2026-08-31T20:20:00-07:00
reviewer: codex-cli
independent: true
task: T-003
attempt: 1
round: 1
verdict: changes_requested
blocking_findings: 1
handoff: trusted-cm-recovery-card-T-003-a1-handoff.json
handoff_sha256: 1f7d777bd127175ada69f5082e6fb3cfbe44fef77855658fe9bd976aaaed79e0
scope:
  - packages/byz/src/recovery/safe-read.js
  - packages/byz/src/recovery/cm-evidence-reader.js
  - packages/byz/test/recovery-reader.test.mjs
---

# Findings

1. **High — current-task review files are read and hashed completely.** The reader allocates the complete review size and passes all bytes to the frontmatter parser. A valid header followed by private or irrelevant body content is therefore read and hashed, violating the header-only evidence contract.

## Contract results

- TC-002: **SUPPORTED**
- TC-003: **SUPPORTED**
- TC-004: **SUPPORTED** for containment, limits, no-follow and identity rejection; review-body minimization is not covered.

verdict: changes_requested
