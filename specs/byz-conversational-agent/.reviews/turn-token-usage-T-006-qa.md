# T-006 Feature QA

## Result

PASS — TC-001 through TC-008 have executable, runtime, mutation, and 80-column TUI evidence.

## Formal commands

- `node --test packages/byz/test/conversation.test.mjs packages/byz/test/architecture.test.mjs`: 40 passed, 0 failed (24 Conversation declarations + 16 architecture declarations; both files are content-bound in attempt 2).
- `npm --prefix packages/byz test`: 216 passed, 1 explicit platform skip, 0 failed (`packages/byz/package.json` binds the `node --test test/*.test.mjs` command).
- `npm run check`: Biome, pinned dependencies, import rules, shrinkwrap/install-lock checks, BYZ architecture, tsgo, and browser smoke passed with no fixes.
- `npm --prefix packages/byz run build`: built the local BYZ package image used by the TUI run.

## Mutation evidence

Two temporary product mutations were executed against the focused tests and then restored to the exact original SHA-256 `ec83d18c35da30019fbaf44af495e85bea83bc04e243d00926709bd99ace36da`:

1. Removing the interval generation comparison made `turn-local execution state is cleared across agent end and session shutdown` fail.
2. Replacing the confirmation generation comparison with `true` made `stale confirmation continuation cannot resume a newer turn` fail.

Result: 2/2 mutations killed; product source restored before final commands.

## 80×24 TUI

Environment: local built BYZ, isolated HOME/agent directory, local OpenAI-compatible faux provider, tmux pane width 80, no real Provider key or paid Token.

Observed snapshots:

```text
BYZ is thinking · 0m 02s · Tokens —
Running · 1 tool running · 0m 03s · Tokens 88
Done · 0m 07s · Tokens 192
BYZ thought for 0m 04s · 1 tool
```

The compact line remained one row at width 80. Prompt, `sleep 3`, tool name, arguments, result, Tasks, and percentages were absent from compact status and completion output. Footer independently showed Session totals `↑180 ↓12`. `--version` returned `0.1.12`, and `workflow list` retained both bundled workflows.

Durable oracle: `.reviews/turn-token-usage-T-006-tui-evidence.md` records pane dimensions, one-row counts, line lengths, sanitized visible lines, forbidden-field absence, exact version stdout, zero stderr bytes, exit code 0, workflow identities, workflow stderr bytes, exit code 0, and fixture cleanup.

Attempt 1 passed all status assertions but the ad-hoc version oracle incorrectly expected a `byz ` prefix. The oracle was corrected to the actual pure semver output; attempt 2 passed. Both fixtures cleaned tmux, server, HOME, model config, and dummy credentials through traps.

## Contract disposition

- TC-001: PASS — 2-second delay, short-turn suppression, unknown/observed Token headline, and stale timeout generation.
- TC-002: PASS — streaming snapshots and multiple responses accumulate exactly once.
- TC-003: PASS — partial/invalid/overflow usage fails closed.
- TC-004: PASS — normal/error/abort/shutdown cleanup, fresh-turn isolation, stale interval, and stale confirmation continuation.
- TC-005: PASS — real 80-column TUI and non-interactive commands.
- TC-006: PASS — parallel, duplicate, malformed, unknown, and out-of-order tool IDs with accurate failure summary.
- TC-007: PASS — model-active time excludes tool and confirmation waiting; stale continuation cannot alter the split.
- TC-008: PASS — Chinese/English compact information boundary, details, Footer, timer count, and redraw behavior.
