---
at: 2026-09-01T06:38:00-07:00
reviewer: codex-cli
independent: true
feature: 3.turn-token-usage
qa_verdict: passed
blocking_findings: 0
manifest: matched
---

# Turn Token Usage v2 — N6 QA final

## Findings

No findings.

## QA r2 manifest finding disposition

`rejected_false_positive`. The prior raw SHA comparison was invalid because CM records semantic hashes and normalizes explicit AC/task runtime checkboxes. The authoritative verifier exited 0 with `status: matched` for all twelve specification files. No manifest regeneration is required.

## Test contracts

- TC-001: PASS — unavailable start, Session isolation, first observed update, and tool-phase retention.
- TC-002: PASS — standalone all-zero remains unavailable; snapshots and responses accumulate once; mixed zero siblings remain `0`.
- TC-003: PASS — missing, partial, invalid, unsafe, and cumulatively overflowing fields fail closed.
- TC-004: PASS — real normal/error/abort/shutdown/post-abort cleanup and side-effect assertions.
- TC-005: PASS — 80×24 TUI, completion summary, packed runtime, and non-interactive evidence.

## Acceptance criteria

AC-001 through AC-010: PASS. AC-004 specifically matches approved option A: mandatory standalone all-zero is unavailable, while mixed positive/zero observed usage preserves legal zero fields.

## Regression summary

- Fresh v2 focused: 34/34 passed.
- BYZ package: 204 passed, 1 platform skip.
- Packed runtime: 2/2 passed.
- `npm run check`: passed.
- Full non-E2E regression: passed.
- Official semantic manifest verifier: matched.
- No implementation change was required for v2.

## Verdict

`qa_verdict: passed`

`blocking_findings: 0`
