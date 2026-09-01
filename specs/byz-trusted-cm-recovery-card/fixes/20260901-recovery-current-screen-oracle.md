# Packed recovery current-screen oracle

- Status: resolved
- Workflow: `cm-fix`
- Task: `T-FIX-recovery-current-screen-oracle`
- Supersedes: `T-FIX-recovery-startup-notification`
- Date: 2026-09-01

## Symptom

The first recovery notification fix was behaviorally correct but could not pass its second review: the non-Darwin packed test searched accumulated PTY bytes. Historical output could contain recovery and diagnostics markers even after ANSI repaint removed recovery from the current screen.

Reproduction evidence showed that the historical predicate returned true while an xterm viewport correctly excluded the erased recovery card: `/tmp/recovery-current-screen-repro.log`.

## Root cause

The non-Darwin packed path treated an append-only process stream as terminal state. Terminal output is a command stream: cursor movement, erase, alternate-screen, and repaint sequences mutate a viewport. Marker search over historical bytes cannot prove simultaneous visibility.

A second boundary defect was intercepted in review: decoding every PTY Buffer independently could split a UTF-8 marker and inject replacement characters before terminal emulation.

## Fix

- Reuse `VirtualTerminal`/xterm to apply ANSI output and read only the visible viewport.
- Fix the emulated PTY dimensions at 100×30 to match the packed startup oracle.
- Require recovery title, task, and delayed diagnostics notice in the same viewport before success.
- Pass raw `Buffer`/`Uint8Array` chunks to xterm so its streaming decoder preserves split UTF-8 sequences.
- Keep `chunk.toString()` only for timeout and premature-exit diagnostics, not pass/fail decisions.
- Widen the test terminal's `write` input to the xterm-supported `string | Uint8Array` contract.

Rejected alternatives:

- keep searching accumulated output: preserves the false positive;
- decode each chunk with `Buffer.toString()`: corrupts split multibyte markers;
- require tmux on all non-Darwin CI hosts: adds an avoidable external tool requirement;
- invoke `/project status`: masks automatic-startup persistence.

## Guard and verification

Red evidence:

- accumulated-history oracle accepted erased markers: `/tmp/recovery-current-screen-guard-red.log`;
- per-chunk UTF-8 decode corrupted a split diagnostics marker: `/tmp/recovery-current-screen-utf8-red.log`.

Green evidence:

- current-screen oracle rejects erase/repaint history and accepts simultaneous markers;
- split multibyte marker survives raw Buffer writes;
- coding-agent status tests: 34 passed;
- TUI render tests: 25 passed;
- packed BYZ suite: 2 passed;
- `npm run check`: passed;
- `./test.sh`: passed, including 1,995 coding-agent tests with expected skips plus all remaining package regressions.

Evidence files:

- `/tmp/recovery-current-screen-green-a2.log`
- `/tmp/recovery-current-screen-check-a2.log`
- `/tmp/recovery-current-screen-full-regression.log`

## Review

- Round 1: `changes_requested`; intercepted split UTF-8 corruption.
- Round 2: `approved`; zero blocking findings.
- N5 content-bound gate: approved.

Review evidence:

- `.reviews/fix-recovery-current-screen-oracle-T-FIX-recovery-current-screen-oracle-r1.md`
- `.reviews/fix-recovery-current-screen-oracle-T-FIX-recovery-current-screen-oracle-r2.md`

## Impact surface

- `packages/coding-agent/src/modes/interactive/interactive-mode.ts`
- `packages/coding-agent/test/interactive-mode-status.test.ts`
- `packages/tui/test/virtual-terminal.ts`
- `scripts/byz-packed-runtime.test.mjs`
- `packages/coding-agent/CHANGELOG.md`
