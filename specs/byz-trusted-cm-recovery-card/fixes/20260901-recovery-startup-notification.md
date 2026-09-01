# Recovery startup notification is overwritten

- Status: superseded and resolved by `T-FIX-recovery-current-screen-oracle`
- Workflow: `cm-fix`
- Task: `T-FIX-recovery-startup-notification`
- Date: 2026-09-01

## Symptom

A trusted BYZ project has valid CM recovery evidence, but the automatic `Project recovery` card is absent after startup. Running `/project status` immediately displays the same card correctly.

Strict reproduction:

```bash
node --test scripts/byz-packed-runtime.test.mjs
```

Before the fix, the packed test timed out after the delayed diagnostics notice replaced the recovery card. Evidence: `/tmp/cm-fix-recovery-packed-red.log`.

## Root cause

Interactive extension `info` notifications use `InteractiveMode.showStatus()`. That method coalesced every adjacent status by replacing the prior `Text` component. The multiline recovery card was therefore treated like a mutable status line and replaced by the diagnostics extension's single-line notice emitted 100 ms later.

An independent cause review rejected the initial `queueMicrotask` scheduling theory and identified the status replacement path. Evidence: `.reviews/fix-recovery-startup-notification-cause-r1.md`.

## Attempted minimal fix

The worktree changes classify messages containing a newline as persistent status cards:

- multiline messages append and clear the replaceable-status references;
- consecutive single-line messages continue to coalesce;
- the regression asserts rendered visibility of both the recovery card and the following diagnostics status;
- the macOS packed test waits until both automatic recovery and delayed diagnostics are visible in the current tmux pane.

Rejected alternatives:

- delaying recovery with `setImmediate`: does not prevent the later diagnostics overwrite;
- relabeling normal recovery as a warning: incorrect UI semantics;
- changing the notification API or transcript rebuild: broader than the root fix;
- weakening packed verification to `/project status`: masks automatic-startup behavior.

## Guard and verification

- Unit baseline before regression: 33 passed.
- Visible-behavior mutant: failed because rendered output lacked `Project recovery`; evidence `/tmp/cm-fix-recovery-visible-red-a2.log`.
- Fixed unit test: 34 passed.
- macOS installed packed BYZ composition: passed after both recovery and delayed diagnostics were visible.
- `npm run check`: passed.

Test files:

- `packages/coding-agent/test/interactive-mode-status.test.ts`
- `scripts/byz-packed-runtime.test.mjs`

## Impact surface

- `packages/coding-agent/src/modes/interactive/interactive-mode.ts`: single-line status coalescing and multiline card persistence.
- BYZ recovery and diagnostics startup composition.
- Installed packed-runtime terminal oracle on macOS and non-Darwin systems.

## Resolution

Round 2 found that the non-Darwin packed path checked an accumulated raw PTY byte stream. Historical bytes could contain both markers even if the current screen no longer showed both, so that task correctly remained blocked and received no attempt 3.

The approved alternative task `T-FIX-recovery-current-screen-oracle` added a raw-byte xterm viewport oracle, passed its own two-round content-bound review, and completed full regression. See `fixes/20260901-recovery-current-screen-oracle.md`.
