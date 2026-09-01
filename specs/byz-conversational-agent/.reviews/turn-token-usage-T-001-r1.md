---
at: 2026-09-01T01:28:00-07:00
reviewer: codex-cli
independent: true
task: T-001
attempt: 1
round: 1
verdict: changes_requested
blocking_findings: 1
handoff: turn-token-usage-T-001-a1-handoff.json
handoff_sha256: 1bf5c1c5e342b0b1d2b2f8fce09c9bc2f2d7b4691352575714a74c7e25b0df57
scope:
  - packages/byz/test/conversation.test.mjs
---

# Findings

1. **Medium — TC-001 does not prove usage survives the subsequent tool phase.** The test observes usage and then ends the response/agent without a tool execution retention assertion. A regression that clears usage when a tool starts would pass.
2. **Low — TC-002 describes three streaming snapshots but sends two.** Two still prove replacement, but the executable regression should match the approved test contract.

## Contract results

- TC-001: **INSUFFICIENT_EVIDENCE**
- TC-002: **SUPPORTED**

verdict: changes_requested
