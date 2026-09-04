---
at: 2026-09-03T02:15:00-07:00
reviewer: codex-cli
independent: true
task: T-028
attempt: 2
round: 2
verdict: blocked
blocking_findings: 5
handoff: open-source-runtime-boundaries-T-028-a2-handoff.json
handoff_sha256: 31328a37885dc8605742c7ae19161ce4a908217e0bc4cf65b8b5265de1efdd33
scope:
  - packages/byz/src/conversation/conversation-controller.js
  - packages/byz/src/conversation/conversation-preferences.js
  - packages/byz/src/conversation/language-catalog.js
  - packages/byz/test/conversation-preferences.test.mjs
  - packages/byz/test/conversation.test.mjs
---

# Verdict

Blocked after the second and final review round.

Remaining findings:
1. Stable descriptor-relative directory writes exist only on Linux; macOS/Windows still have same-user replacement windows.
2. A controlled same-field helping schedule can publish A→B→A and consume three revisions for two calls.
3. Claim hard-link creation is not followed immediately by directory fsync.
4. Recursive first-directory creation can chmod an existing shared ancestor and can fsync a replaced parent.
5. Missing preference parent is incorrectly diagnosed unavailable, and adversarial coverage remains incomplete.

T-028 is frozen; no attempt 3 is permitted. A replacement must return to the documented BYZ non-sandbox threat boundary rather than claim portable protection against arbitrary same-user filesystem mutation that Node cannot provide without descriptor-relative openat/renameat APIs.
