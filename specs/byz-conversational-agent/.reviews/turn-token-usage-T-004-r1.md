---
at: 2026-09-02T00:20:08-07:00
reviewer: codex-cli
independent: true
task: T-004
attempt: 1
round: 1
verdict: changes_requested
blocking_findings: 4
handoff: turn-token-usage-T-004-a1-handoff.json
handoff_sha256: c74f5bd1645d0dcd554060f30cb90452cb244ab0ce3dddf0fa00642868daba4c
scope:
  - packages/byz/test/conversation.test.mjs
---

# Findings

1. **High — timeout seam causes TC-001 to fail before observing the old 8-second behavior.** Injected timeout functions are not consumed by the old implementation, so the red test proves a missing seam rather than the approved visibility behavior.
2. **High — short turns ending before two seconds are not covered.** A cleanup flash or stale reveal callback could pass.
3. **High — the bilingual compact test exercises only English.** Chinese parity and malicious result/assistant body boundaries are not observed.
4. **High — v3 lifecycle compatibility is incomplete.** New tool/model state reset, shutdown/next-turn isolation and timer cardinality are not directly asserted; existing details/Footer tests remain useful but do not prove the new state is cleared.

# Contract results

- TC-001: `CONTRADICTED`
- TC-002: `SUPPORTED`
- TC-003: `SUPPORTED`
- TC-004: `INSUFFICIENT_EVIDENCE`
- TC-006: `SUPPORTED`
- TC-007: `SUPPORTED`
- TC-008: `CONTRADICTED`

Verdict: `changes_requested`.
