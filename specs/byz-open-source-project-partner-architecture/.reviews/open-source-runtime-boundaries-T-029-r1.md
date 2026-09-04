---
at: 2026-09-03T02:30:00-07:00
reviewer: codex-cli
independent: true
task: T-029
attempt: 1
round: 1
verdict: changes_requested
blocking_findings: 2
handoff: open-source-runtime-boundaries-T-029-a1-handoff.json
handoff_sha256: 7b51e515a252409ed2607e9c9b0771c5df1da5464ca7c2c8c57a8ccab17b9f83
scope:
  - packages/byz/src/conversation/conversation-controller.js
  - packages/byz/src/conversation/conversation-preferences.js
  - packages/byz/src/conversation/language-catalog.js
  - packages/byz/test/conversation-preferences.test.mjs
  - packages/byz/test/conversation.test.mjs
---

# Verdict

Changes requested.

1. A complete fsynced claim left by an ordinary process crash permanently returns field busy; add owner-liveness metadata and recover dead-owner claims without helping live owners.
2. Legacy parsing drops a valid field when its sibling is invalid; salvage fields independently while retaining corrupt diagnostics.

Also validate/repair a pre-existing regular corrupt slot's maximum size and mode, with regressions for all three cases.
