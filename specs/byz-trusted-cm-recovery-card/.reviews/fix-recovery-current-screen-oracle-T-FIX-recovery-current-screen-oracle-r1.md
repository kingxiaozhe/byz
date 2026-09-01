---
at: 2026-09-01T04:25:00-07:00
reviewer: codex-cli
independent: true
task: T-FIX-recovery-current-screen-oracle
attempt: 1
round: 1
verdict: changes_requested
blocking_findings: 1
handoff: fix-recovery-current-screen-oracle-T-FIX-recovery-current-screen-oracle-a1-handoff.json
handoff_sha256: 40dda101281f6f55c518918925c38afb40f7b6a787ee0a1dfffdcb014300de8d
scope:
  - packages/coding-agent/CHANGELOG.md
  - packages/coding-agent/src/modes/interactive/interactive-mode.ts
  - packages/coding-agent/test/interactive-mode-status.test.ts
  - scripts/byz-packed-runtime.test.mjs
---

## Finding

1. **High — independently decoding each PTY Buffer can corrupt a split UTF-8 marker.**

   The non-Darwin collector calls `chunk.toString()` before passing text to the current-screen oracle. If a stream boundary splits the bytes of `BYZ 本地诊断已开启`, replacement characters reach the terminal emulator. A valid viewport then fails `hasStableRecovery()` and Linux times out. The current oracle test uses complete JavaScript strings and does not cover byte fragmentation.

## Prior blocker disposition

The accumulated-history false positive is resolved for correctly decoded input. The VirtualTerminal viewport rejects recovery after ANSI clear/repaint and accepts the unsplit simultaneous viewport. The superseding task remains blocked until raw PTY bytes cross the oracle boundary without per-chunk UTF-8 decoding.

## Test assessment

The red evidence correctly captures the historical-marker false positive, the status regression remains valid, and static checks pass. A split-byte regression must fail before the fix and pass after raw `Uint8Array` input is parsed by the terminal emulator.
