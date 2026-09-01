---
at: 2026-09-01T03:20:00-07:00
reviewer: codex-cli
independent: true
workflow: cm-fix
task: T-FIX-recovery-startup-notification
verdict: changes_requested
blocking_findings: 2
scope:
  - packages/byz/src/recovery/recovery-extension.js
  - packages/byz/src/diagnostics/diagnostics-extension.js
  - packages/coding-agent/src/modes/interactive/interactive-mode.ts
  - packages/byz/test/recovery-extension.test.mjs
  - scripts/byz-packed-runtime.test.mjs
---

## Findings

1. **High — `setImmediate` does not address the observed overwrite path.**

   Initial startup does not clear `chatContainer` after extension binding. Recovery emits its multiline card as an `info` notification. Interactive mode maps extension `info` notifications to `showStatus()`, where adjacent statuses reuse and replace the preceding `Text` component. The diagnostics extension emits another `info` notification 100 ms after startup. In a fresh diagnostics home, that delayed notice replaces the recovery card. `autoShown` remains true, while `/project status` runs after the delayed notice and therefore survives.

2. **High — the proposed transcript-reset regression models a boundary absent from production.**

   A synthetic notification clear could turn green after a scheduler change without exercising the recovery-versus-diagnostics status coalescing that causes the packed failure.

## Lifecycle assessment

Changing the scheduler would retain trust, dismissal, reload, shutdown, and Node portability guards, but would not fix the destructive status replacement. The smallest defensible fix is to prevent multiline extension cards from participating in mutable single-line status coalescing. Relabeling a normal recovery card as a warning is semantically incorrect; arbitrary delay remains brittle.

## Disposition

Accepted. Root-cause analysis returned to Step 2. The revised root cause is adjacent `info` notification coalescing: a delayed diagnostics status overwrites the multiline recovery card. The revised guard directly exercises multiline-card persistence, and the packed test remains the composition-level proof.
