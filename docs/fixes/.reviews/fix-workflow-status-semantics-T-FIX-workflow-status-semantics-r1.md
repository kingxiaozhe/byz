---
at: 2026-08-28T00:21:38-07:00
reviewer: codex-cli
independent: true
task: T-FIX-workflow-status-semantics
attempt: 1
round: 1
verdict: changes_requested
blocking_findings: 2
handoff: fix-workflow-status-semantics-T-FIX-workflow-status-semantics-a1-handoff.json
handoff_sha256: d292acbe6213ebb81f25ddb5c4d17c19c1faa087ea4134526c8b63fddad5f06e
scope:
  - docs/fixes/20260828-workflow-status-semantics.md
  - packages/byz/src/cli.js
  - packages/byz/src/workflows.js
  - packages/byz/test/smoke.test.mjs
---

## P2: Help advertises unsupported `workflow check none`

The shared target suffix applies to `list`, `status`, and `check`, but `none` is only a valid status target or global workflow selection. `byz workflow check none` still exits with `Unknown workflow: none`. Use command-specific syntax instead of advertising that combination.

## P2: Defect record claims review evidence before it exists

The defect record says independent review is recorded while only the ready-for-review handoff exists. Update the record to reflect the actual review rounds before landing.

The reviewer independently reran the 31 smoke tests and the complete 49-test BYZ package suite; both passed. The workflow-status implementation itself had no additional correctness finding.
