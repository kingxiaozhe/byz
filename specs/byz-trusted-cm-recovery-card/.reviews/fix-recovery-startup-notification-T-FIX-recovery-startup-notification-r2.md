---
at: 2026-09-01T03:58:00-07:00
reviewer: codex-cli
independent: true
task: T-FIX-recovery-startup-notification
attempt: 2
round: 2
verdict: blocked
blocking_findings: 1
handoff: fix-recovery-startup-notification-T-FIX-recovery-startup-notification-a2-handoff.json
handoff_sha256: 6131768ec5740b6b6b46ba1fcf822bab8ec648ddb04860c63c6beeffce579c20
scope:
  - packages/coding-agent/CHANGELOG.md
  - packages/coding-agent/src/modes/interactive/interactive-mode.ts
  - packages/coding-agent/test/interactive-mode-status.test.ts
  - scripts/byz-packed-runtime.test.mjs
---

## Finding

1. **High — Linux packed test can still pass without simultaneous visibility.**

   The non-Darwin path accumulates raw PTY output and evaluates `hasStableRecovery(output)` against the entire history. If recovery is rendered and later overwritten by diagnostics, historical bytes still contain all markers, so Linux can report success even though the recovery card and delayed diagnostics notice were never simultaneously visible.

## Attempt 1 finding disposition

- Visible unit assertion: resolved. The mutant now fails specifically because rendered output lacks `Project recovery`.
- Packed composition evidence: resolved on macOS current-screen capture, but remains blocking on the non-Darwin accumulated-stream path.

## Test assessment

The implementation itself and its unit red/green evidence are valid. Single-line coalescing remains covered, no dependency or notification API redesign was introduced, and static checks pass. The remaining blocker is cross-platform packed proof, not a demonstrated defect in the multiline persistence implementation.

## Verdict

`blocked`. This is round 2; no attempt 3 is permitted. A separately approved alternative task must establish a current-screen terminal oracle for non-Darwin packed execution before this fix can be accepted.
