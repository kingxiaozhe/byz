---
at: 2026-09-01T06:30:00-07:00
reviewer: codex-cli
independent: true
feature: 3.turn-token-usage
qa_verdict: failed
blocking_findings: 1
---

# Turn Token Usage v2 — N6 QA attempt 1

## Finding

The reviewer compared raw file SHA-256 values for `requirements.md` and `tasks.md` with `.cm-specs-status` and reported a manifest mismatch. All behavior, test contracts, AC-001 through AC-010, and TC-001 through TC-005 passed.

## Prior QA finding

Resolved. V2 explicitly adopts human-approved option A: standalone mandatory all-zero without independent presence evidence remains unavailable, while positive payloads preserve explicit legal zero siblings. Executable Adapter assertions cover `message_update`, `message_end`, and `agent_end` plus mixed positive/zero preservation.

## Results

- TC-001 through TC-005: PASS.
- AC-001 through AC-010: PASS.
- Fresh v2 focused: 34/34 passed.
- BYZ package: 204 passed, 1 platform skip.
- Packed runtime: 2/2 passed.
- `npm run check`: passed.
- Full non-E2E regression: passed.

## Verdict

`qa_verdict: failed`

`blocking_findings: 1`

The reported blocker is adjudicated separately because CM manifests use semantic hashes that normalize runtime AC/task checkboxes.
