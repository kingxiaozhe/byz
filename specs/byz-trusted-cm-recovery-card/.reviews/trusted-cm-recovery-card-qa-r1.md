---
at: 2026-08-31T21:56:00-07:00
reviewer: codex-cli
independent: true
feature: trusted-cm-recovery-card
verdict: passed
test_cases: 10
passed: 10
failed: 0
blocked: 0
artifact_sha256: 199f472892aa0751234e93a66e1ddfde7309a0e24a382fe6cb9bc3d04cdcb744
---

# N6 QA

| Test case | Verdict |
| --- | --- |
| TC-001 | PASS |
| TC-002 | PASS |
| TC-003 | PASS |
| TC-004 | PASS |
| TC-005 | PASS |
| TC-006 | PASS |
| TC-007 | PASS |
| TC-008 | PASS |
| TC-009 | PASS |
| TC-010 | PASS |

AC-001 through AC-022 have executable or packed-runtime evidence under v5. The macOS junction case has an explicit, contract-approved skip; all constructible identity, symlink and non-regular variants pass. T-002, T-003 and T-010 remain dropped and contribute no completion credit.

Residual boundaries: same-user ancestor replacement is detection-based rather than an OS sandbox; global CM history/index and Git working-tree evidence remain P1-deferred.

qa_verdict: passed
