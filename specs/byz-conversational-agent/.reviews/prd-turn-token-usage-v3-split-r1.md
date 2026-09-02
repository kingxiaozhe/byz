---
at: 2026-09-01T23:42:37-07:00
reviewer: codex-cli
independent: true
stage: split
feature: turn-token-usage-v3
scope:
  - 3.turn-token-usage/requirements.md
  - 3.turn-token-usage/design.md
  - 3.turn-token-usage/tasks.md
  - 3.turn-token-usage/test-cases.json
---

# Findings

1. **High — parallel tool state can be overwritten by assistant or unpaired events.** The design transitions directly on events instead of deriving one state from signal priority. While a valid tool remains in-flight, assistant updates or unpaired tool events could move timing to reply/recover and count tool time as model-active.
2. **Medium — path security scope conflicts with details compatibility.** F-005 globally forbids paths while AC-015/design retain existing explicit details activity, which currently consumes path/command arguments.
3. **Medium — baseline task does not own all v3 red logic tests.** Parallel pairing, status priority, model-active timing, completion statistics and compact security tests were assigned to the implementation task, weakening the required test-first boundary.

# Verdict

Solution direction: `CHANGES_REQUESTED`.
Task split: `CHANGES_REQUESTED`.

Apply all three findings, rerun the single machine self-check, and do not dispatch a second specification review.
