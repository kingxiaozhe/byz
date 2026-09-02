---
at: 2026-09-02T07:30:00-07:00
task: T-009
feature: 4.structured-execution-registry
mode: implementation
verdict: passed
blocking_cases: 8
passed: 8
failed: 0
blocked: 0
---

# Feature 4 final QA

T-009 takes ownership of the uncommitted T-005 implementation, tests and QA evidence after T-005 reached its two-round review limit. The remaining T-005 blocker was evidence reproducibility, not product behavior.

## Durable verification

- The persisted `structured-execution-registry-T-009-evidence-script.sh.txt` defines every variable and contains the exact extension setup, isolated trust/auth setup, build, CLI, tmux, assertion, test, check and cleanup commands.
- The persisted `structured-execution-registry-T-009-faux-extension.ts.txt` is content-hashed by the command evidence and drives the real managed `plan_open → plan_seal → task_start task-64` flow.
- `structured-execution-registry-T-009-command-evidence.md` records HEAD, branch, script/extension/working-diff SHA-256 values, complete relevant output and 13 explicit `exit_code=0` results.
- `npm --prefix packages/byz run build`: passed.
- Built CLI `--version` and `--workflow none --version`: both printed `0.1.12` and exited 0.
- No-plan real BYZ TUI in isolated 80×24 tmux: no Step, Tasks or percentage; maximum captured line length 80 Unicode code points; cleanup proved the session absent.
- Real managed 64-task BYZ TUI in isolated 80×24 tmux: exactly one `Preparing reply · Step 64/64 · … · Tokens …` line; maximum captured line length 80 Unicode code points; no launch path appears in the pane; cleanup proved the session absent.
- `npm --prefix packages/byz test`: 254 passed, 0 failed, 1 platform-specific skip.
- Focused registry/managed-tool/Conversation/architecture run: 78 passed, 0 failed.
- `npm run check` and `git diff --check`: passed.
- The isolated HOME, helper, runtime extension and both tmux sessions were removed. No external provider endpoint, remote Git action or production release was used.

## Blocking test contract

| Case | Result | Evidence |
| --- | --- | --- |
| TC-001 | PASS | Closed reducer and Conversation reliable ordinal tests |
| TC-002 | PASS | Damaged replay, hostile sequence/generation and forged completion tests |
| TC-003 | PASS | Declared/observed/verified provenance and raw-field privacy tests |
| TC-004 | PASS | Append atomicity, replay and bounded persisted lifecycle-closure receipts |
| TC-005 | PASS | Parallel start-time task binding and out-of-order pairing test |
| TC-006 | PASS | No-plan, details, Token, timer and subscription compatibility tests |
| TC-007 | PASS | Persisted real 80×24 no-plan and 64-task faux managed-tool panes plus exact commands |
| TC-008 | PASS | One real frozen consumer shared across Conversation/Pause/Delivery simulations |

## Acceptance

AC-001 through AC-015 pass. Feature 4 remains Session-scoped, bounded and closed-schema; it does not parse model prose, invent runtime tasks or progress, expose raw tool fields, create a second database, or execute Feature 5/6 behavior.
