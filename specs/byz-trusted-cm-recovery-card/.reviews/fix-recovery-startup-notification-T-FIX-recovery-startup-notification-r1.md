---
at: 2026-09-01T03:41:00-07:00
reviewer: codex-cli
independent: true
task: T-FIX-recovery-startup-notification
attempt: 1
round: 1
verdict: changes_requested
blocking_findings: 2
handoff: fix-recovery-startup-notification-T-FIX-recovery-startup-notification-a1-handoff.json
handoff_sha256: 28de03c7c7abdfbd16409d4254bc0004263d031931229895b89c37f02cf028ad
scope:
  - packages/coding-agent/CHANGELOG.md
  - packages/coding-agent/src/modes/interactive/interactive-mode.ts
  - packages/coding-agent/test/interactive-mode-status.test.ts
---

## Findings

1. **High — packed verification does not close composition risk.**

   The helper succeeds immediately after observing `Project recovery`; it does not wait for the delayed diagnostics notice or verify both remain visible together. A packed runtime can therefore briefly display recovery, later replace it, and still pass.

2. **Medium — regression fails first on internal child count rather than visible disappearance.**

   The recorded red reason is `length 2 instead of 4`, not the user-visible absence of `Project recovery`. A harmless component-layout refactor could fail while rendering correctly. Assert rendered presence of both messages before, or instead of, the structural count.

## Test assessment

The implementation itself correctly handles multiline→single-line, single-line→multiline, multiline→multiline, and single-line→single-line. Clearing references after multiline content cannot replace a persistent card; the following single-line status establishes fresh references so later single-line statuses coalesce. Leading or trailing newlines remain multiline, while terminal wrapping does not alter classification.

## Verdict

`changes_requested`; both findings block because the guard and packed proof do not yet fail for exactly the reported user-visible persistence defect.
