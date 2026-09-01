---
at: 2026-08-31T21:18:00-07:00
reviewer: codex-cli
independent: true
task: T-006
attempt: 1
round: 1
verdict: changes_requested
blocking_findings: 1
handoff: trusted-cm-recovery-card-T-006-a1-handoff.json
handoff_sha256: 4fc88d7525d16610077a2b2555b9b2e05686c4a37f6927afc6bdc83203af11d7
scope:
  - packages/byz/src/recovery/recovery-extension.js
  - packages/byz/test/recovery-extension.test.mjs
---

# Findings

1. **High — injectable renderers receive raw projection input.** A renderer can return a malicious CM field directly, bypassing the default renderer's field sanitizer. Renderer inputs must be a bounded sanitized projection rather than raw reducer/receipt values.

- TC-001: **SUPPORTED** for T-006.
- TC-002: **SUPPORTED**.
- TC-006: **SUPPORTED** for T-006.
- TC-007: **CONTRADICTED**.
- TC-008: **SUPPORTED**.
- TC-009: **SUPPORTED** for T-006.

verdict: changes_requested
