---
at: 2026-09-03T00:00:00-07:00
reviewer: codex-cli
independent: true
task: T-027
attempt: 1
round: 1
verdict: changes_requested
blocking_findings: 3
handoff: open-source-runtime-boundaries-T-027-a1-handoff.json
handoff_sha256: a465a5df553a76d095d47572bb25214661c1a1709d175d0052f675df8a87a65f
scope:
  - packages/byz/src/update.js
  - packages/byz/test/update.test.mjs
---

# Verdict

Changes requested with three blocking findings.

1. Node may emit `error` synchronously from a failed `child.kill("SIGTERM")`; the current error handler settles immediately and suppresses the required SIGKILL escalation.
2. Final Promise rejection does not destroy/unref live child and pipe handles, so a descendant retaining stdio can keep the CLI process alive after the logical deadline.
3. Windows cannot reliably execute the literal `npm` command with `shell: false`; resolve the fixed npm CLI through the current Node executable without introducing shell interpolation.

Non-blocking but required in the same correction: normalize native exit statuses outside 1..255 while retaining the original status in bounded stderr. Add real-child/descendant, kill-error ordering, Windows spawn-resolution and native-status regressions.
