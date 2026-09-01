---
at: 2026-08-31T21:37:00-07:00
reviewer: codex-cli
independent: true
task: T-008
attempt: 1
round: 1
verdict: changes_requested
blocking_findings: 2
handoff: trusted-cm-recovery-card-T-008-a1-handoff.json
handoff_sha256: 0b846f34714adf928cb8738913a8c40b7326ebc419b61e72a19205f64f8d00c6
scope:
  - scripts/byz-packed-runtime.test.mjs
  - specs/byz-trusted-cm-recovery-card/.reviews/trusted-cm-recovery-card-T-008-artifact-receipt.json
---

# Findings

1. **High — packed recovery is invoked as a module, not through actual installed CLI composition.** The TUI smoke does not assert recovery-card output and macOS only checks a theme file.
2. **High — package and startup checks do not explicitly prove no lifecycle hooks/watcher/daemon or project-state writes.** Add lifecycle/package-path assertions and a before/after CM fixture snapshot around actual startup.

The implementation-hash concern is rejected: the mechanical N4 gate returned `content_bound: true` for the exact scoped files.

- TC-010 T-008 portion: **CONTRADICTED** pending the two additions.

verdict: changes_requested
