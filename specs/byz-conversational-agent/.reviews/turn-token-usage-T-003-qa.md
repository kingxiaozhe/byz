# T-003 QA evidence

## Result

PASS — TC-001 through TC-005 have executable/runtime evidence.

## Commands

- `node --test packages/byz/test/conversation.test.mjs`: 18/18 passed; actual `AgentSession` error and abort paths first observe nonzero usage, then emit `agent_end`, clear the working message and clear exactly one interval per run.
- `npm --prefix packages/byz test`: 204 passed, 1 explicit platform skip.
- `npm run check`: passed all static gates.
- `node --test scripts/byz-packed-runtime.test.mjs`: 2/2 passed from an installed tarball; the fixture explicitly selects project trust and requires recovery plus delayed diagnostics in one current viewport.
- `./test.sh`: passed full non-E2E workspace regression; principal coding-agent suite reported 1995 passed / 50 skipped and all subsequent package suites passed.
- Runtime side-effect checks: four Agent runs created/cleared exactly four intervals, made exactly five expected faux model calls, made zero network calls, created no new agent-directory files, and registered no diagnostics extension.
- Mutation: removing `clearElapsedTimer()` from `finishTurn()` made the cleanup probe fail `0 !== 1`; exact product source bytes were restored and hash-checked.

## 80-column TUI

Environment: 80x24 tmux, isolated HOME/agent directory, local OpenAI-compatible faux server, no real provider, API or paid token.

Observed snapshots:

1. Before usage: `Tokens —` beside the active stage timer.
2. First response/tool phase: `Tokens ↑80 · ↓8`; Footer independently showed Session cumulative `↑80 ↓8 R40`.
3. Completion: `Tokens: input 180; output 12; cache read 90; cache write 0`.
4. Pane width was exactly 80 columns; `--version` and `workflow list` retained their non-interactive behavior.
5. tmux, faux server, temporary HOME and model configuration were removed.

## Packed fixture recovery

The existing packed-runtime test initially timed out because its isolated project had no explicit trust decision, so the trust-gated Recovery Card correctly performed zero reads. The fixture now writes an explicit trust decision. Its non-Darwin path also applies raw PTY bytes to an xterm viewport, preventing accumulated-history false positives and preserving split UTF-8 markers. The installed-package matrix passes only when recovery and the delayed diagnostics notice remain simultaneously visible.

## Contract disposition

- TC-001: PASS
- TC-002: PASS
- TC-003: PASS
- TC-004: PASS — normal, error-after-observed, abort-after-observed and post-abort runs emitted four `agent_end` events; static content-bound review confirms `turnUsage = undefined`, while runtime assertions confirm working/timer cleanup and prohibited-side-effect invariance.
- TC-005: PASS
