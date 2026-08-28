---
at: 2026-08-28T00:26:23-07:00
reviewer: codex-cli
independent: true
task: T-FIX-workflow-status-semantics
attempt: 2
round: 2
verdict: approved
blocking_findings: 0
handoff: fix-workflow-status-semantics-T-FIX-workflow-status-semantics-a2-handoff.json
handoff_sha256: 7a258078b1154ad076ce18bf0fad9c79d5ce4bf9883bef44575a8804a69d3566
scope:
  - docs/fixes/20260828-workflow-status-semantics.md
  - packages/byz/src/cli.js
  - packages/byz/src/workflows.js
  - packages/byz/test/smoke.test.mjs
---

Zero findings.

The change carries the parsed effective workflow into status handling, preserves explicit positional status targets, and bypasses unrelated CM root validation for the resource-free `none` workflow. The command-specific help no longer advertises `none` as a check target, and the defect record accurately describes the first review correction.

The reviewer independently reran all 49 BYZ package tests and `git diff --check`; both passed.

Residual risk: this command reports availability for `cm` and `cm-plugin` rather than introducing a second active-state label, which preserves the existing status output contract while still identifying the effective workflow by name.
