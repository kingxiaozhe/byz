---
at: 2026-09-02T06:40:00-07:00
task: T-005
feature: 4.structured-execution-registry
mode: implementation
verdict: passed
blocking_cases: 8
passed: 8
failed: 0
blocked: 0
---

# Feature 4 QA

## Automated evidence

- `npm --prefix packages/byz run build`: passed; generated local BYZ package image.
- `npm --prefix packages/byz test`: 254 passed, 0 failed, 1 platform skip.
- Focused registry/managed-tool/Conversation/architecture run: 78 passed, 0 failed.
- Real `AgentSession` with faux provider: created, sealed and activated task 64 of 64 through the real `byz_execution` tool; no network calls; three closed Session entries; visible `Step 64/64` lines remained single-line and at most 80 columns.
- `npm run check`: passed.
- Built CLI `--version` and `--workflow none --version`: both returned `0.1.12`.
- Isolated 80×24 tmux: interactive BYZ started with no plan, showed no Step/Tasks/progress percentage, and every captured TUI line was at most 80 Unicode code points. A second isolated run loaded the faux provider through a temporary extension, called the real managed tool to open/seal 64 tasks and activate task 64, then captured exactly one `Preparing reply · Step 64/64 · … · Tokens …` line at 80 columns. The first no-plan harness attempt counted box-drawing UTF-8 bytes rather than terminal characters and was retried with a Unicode-aware assertion; the retry passed and all resources were cleaned.
- Durable command output, working-diff digest, build-image identity and exit codes are stored in `structured-execution-registry-T-005-commands.log`; the real TUI pane is stored in `structured-execution-registry-T-005-tui-capture.txt`.

## Blocking test contract

| Case | Result | Evidence |
| --- | --- | --- |
| TC-001 | PASS | Closed reducer and Conversation reliable ordinal tests |
| TC-002 | PASS | Damaged replay, hostile sequence/generation and forged completion tests |
| TC-003 | PASS | Declared/observed/verified provenance and raw-field privacy tests |
| TC-004 | PASS | Append atomicity, replay and bounded persisted lifecycle-closure receipts |
| TC-005 | PASS | Parallel start-time task binding and out-of-order pairing test |
| TC-006 | PASS | No-plan, details, Token, timer and subscription compatibility tests |
| TC-007 | PASS | Real faux managed-tool flow captured inside isolated 80×24 tmux |
| TC-008 | PASS | One real consumer shared across Conversation/Pause/Delivery simulations with mutation isolation |

## Acceptance criteria

AC-001 through AC-015 passed. Evidence covers no-plan compatibility, exact 1–64 plan bounds, legal transitions, tool pairing, provenance separation, append-before-commit, fail-closed replay and recovery, lifecycle cleanup, bilingual compact/details/completion rendering, Session-only persistence, 80-column behavior and frozen consumer isolation.

No model API, external network, project-state database, diagnostics write path, global memory, remote Git action or production release was used.
