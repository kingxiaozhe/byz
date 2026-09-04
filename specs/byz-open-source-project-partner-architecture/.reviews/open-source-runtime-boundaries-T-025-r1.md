---
at: 2026-09-02T21:27:25-07:00
reviewer: codex-cli
independent: true
task: T-025
attempt: 1
round: 1
verdict: changes_requested
blocking_findings: 2
handoff: open-source-runtime-boundaries-T-025-a1-handoff.json
handoff_sha256: 6f3ed28f84a412ccf559fb9f2762448e3627727f2fb84726087d0e357d636caa
scope:
  - packages/byz/scripts/check-architecture.mjs
  - packages/byz/src/adapters/pi/pi-runtime-adapter.ts
  - packages/byz/src/application/ports/runtime.ts
  - packages/byz/src/cli.js
  - packages/byz/src/fast-session.js
  - packages/byz/src/prewalk.js
  - packages/byz/test/architecture.test.mjs
  - packages/byz/test/fast-switch.test.mjs
  - packages/byz/test/prewalk.test.mjs
---

# Findings

1. **P2 — Normalize the composition path before comparing.** On Windows, `node:path.relative()` returns `src\\cli.js`; comparing it directly with `src/cli.js` classifies every valid mount as outside the composition root and makes the mandatory architecture check fail.
2. **P2 — Remove the name-only fallback for resolved symbols.** An unrelated parameter or local function named `conversationExtension` receives an ordinary symbol but is still classified through `FEATURE_INSTANCES.get(expression.text)`, producing a false out-of-composition call and duplicate count. Name fallback may apply only to intentionally unresolved fixture globals; resolved symbols must have proven tracked origin.

The three T-025 replacement targets are otherwise implemented, but these false positives make the architecture gate unreliable. Attempt 2 must add direct regressions and preserve the hostile fixtures.

## Logic-case disposition

- TC-002: `CONTRADICTED` — the dependency gate is not platform- and symbol-reliable yet.
- TC-003: `SUPPORTED` — managed-resource behavior is unchanged.
- TC-015: `CONTRADICTED` — valid composition fails on Windows path semantics.
- TC-016: `CONTRADICTED` — the hostile cases pass, but unrelated resolved names are not isolated.
