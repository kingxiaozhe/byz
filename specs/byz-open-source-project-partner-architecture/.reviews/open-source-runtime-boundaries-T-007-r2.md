---
at: 2026-09-03T01:20:00-07:00
reviewer: codex-cli
independent: true
task: T-007
attempt: 2
round: 2
verdict: blocked
blocking_findings: 4
handoff: open-source-runtime-boundaries-T-007-a2-handoff.json
handoff_sha256: 94ea7d7383684d5f6cc70a696680868149dda482a615736d4bb5a5cc9aaa70e8
scope:
  - packages/byz/src/conversation/conversation-controller.js
  - packages/byz/src/conversation/conversation-preferences.js
  - packages/byz/test/conversation-preferences.test.mjs
  - packages/byz/test/conversation.test.mjs
---

# Verdict

Blocked after the second and final review round.

Blocking findings:
1. A symlinked preference directory bypasses the current read guard and can cause external-file chmod/read.
2. Descriptor reads lack a post-read identity fence; publication and post-rename chmod remain pathname replacement windows.
3. Lock stale takeover and release use read/check/rename rather than an atomic ownership fence, so a replaced newer lock can be moved.
4. Lock installation does not fsync candidate/parent metadata, and malformed crash remnants are never recoverable.

Additional required corrections: unexpected process probe errors must remain unknown; production must consume diagnostics by default; replacement tests must deterministically cover the revised concurrency and filesystem model.

T-007 is frozen. No attempt 3 is permitted.
