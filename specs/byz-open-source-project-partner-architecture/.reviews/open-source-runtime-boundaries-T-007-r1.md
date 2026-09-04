---
at: 2026-09-03T01:00:00-07:00
reviewer: codex-cli
independent: true
task: T-007
attempt: 1
round: 1
verdict: changes_requested
blocking_findings: 3
handoff: open-source-runtime-boundaries-T-007-a1-handoff.json
handoff_sha256: 4258c643fbfd709746115137f87f0aa7b7d51e134017129b39722be0aeb568be
scope:
  - packages/byz/src/conversation/conversation-controller.js
  - packages/byz/src/conversation/conversation-preferences.js
  - packages/byz/test/conversation-preferences.test.mjs
  - packages/byz/test/conversation.test.mjs
---

# Verdict

Changes requested.

Blocking findings:
1. A reader could diagnose old corrupt bytes and then rename a newer valid pathname into quarantine.
2. Anonymous directory locks could remain forever after writer death and cleanup was not ownership-fenced.
3. lstat followed by pathname read allowed symlink/non-regular/oversized replacement races.

Required accompanying fixes: asynchronous locked reread, migration of existing modes, parent-directory fsync, strict complete schema/update values, surfaced initialization diagnostics, and deterministic crash/race coverage.
