---
at: 2026-08-31T09:31:00-07:00
reviewer: codex-cli
independent: true
stage: split
feature: trusted-cm-recovery-card
verdict: changes_requested
blocking_findings: 4
scope:
  - 1.trusted-cm-recovery-card/requirements.md
  - 1.trusted-cm-recovery-card/design.md
  - 1.trusted-cm-recovery-card/tasks.md
  - 1.trusted-cm-recovery-card/test-cases.json
  - .reviews/prd-trusted-cm-recovery-card-design-r1.md
  - .reviews/prd-trusted-cm-recovery-card-design-disposition.json
---

# Findings

1. **High — B3 baseline omits `./test.sh`.** T-001 must run the same full non-e2e baseline that T-009 reruns so late failures can be attributed.
2. **High — session-start reason projection has no explicit adapter owner or full lifecycle test.** T-005 must own allowlisted reason projection; the real adapter test must parameterize startup/reload/new/resume/fork.
3. **High — inert Git lacks explicit Git-missing and invalid/private-empty-hooks-boundary tests.** Both must fail closed to unavailable with no unsafe fallback.
4. **Medium — independent read limits are not all proven.** T-003/TC-004 must parameterize direct-child/review file count, single-file, total bytes, JSONL bytes and event count, and show rejection before eager reads.

All four findings are accepted and applied once. Per CM PRD policy this review is not repeated.

Verdict: changes_requested
