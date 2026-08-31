---
at: 2026-08-31T07:24:00-07:00
reviewer: codex-cli
independent: true
task: T-022
attempt: 1
round: 1
verdict: changes_requested
blocking_findings: 5
handoff: open-source-runtime-boundaries-T-022-a1-handoff.json
handoff_sha256: 7ff5f3c109ba1c47dbcd81cea204245fd32b8e59f440df19c76b3842200857f2
scope:
  - package-lock.json
  - package.json
  - packages/byz/CHANGELOG.md
  - packages/byz/package.json
  - packages/byz/scripts/check-architecture.mjs
  - packages/byz/src/adapters/pi/pi-runtime-adapter.ts
  - packages/byz/src/application/ports/runtime.ts
  - packages/byz/src/cli.js
  - packages/byz/src/conversation/conversation-extension.js
  - packages/byz/src/diagnostics/diagnostics-extension.js
  - packages/byz/src/fast-session.js
  - packages/byz/src/prewalk.js
  - packages/byz/src/workflow-switch.js
  - packages/byz/test/architecture.test.mjs
  - packages/byz/test/prewalk.test.mjs
  - packages/byz/test/workflow-switch.test.mjs
  - packages/coding-agent/CHANGELOG.md
  - packages/coding-agent/src/index.ts
  - packages/coding-agent/src/main.ts
  - packages/coding-agent/src/modes/index.ts
  - packages/coding-agent/src/modes/interactive/interactive-mode.ts
  - packages/coding-agent/test/interactive-product-profile.test.ts
  - scripts/byz-packed-runtime.test.mjs
---

# Findings

1. **High — Prewalk receives undeclared model capabilities.** `PrewalkContext` extends and spreads the complete Fast context, exposing current model and model/auth registry despite the approved Prewalk slice being limited to command/tool-result, tool catalog, trust, cwd, idle and UI.
2. **High — Fast restoration breaks after extension reload.** An active Fast controller retains model references branded by the old adapter projector; reload creates a new projector, so `/fast off` cannot resolve and restore the old snapshot.
3. **High — `tool_execution_end.args` leaks an unprojected raw nested object.** The top-level event is frozen but the original args reference remains reachable by Conversation.
4. **High — The architecture gate does not mechanically prevent raw-Pi composition or alternate Proxy forms.** It checks two source strings and expected CLI substrings, so an additional raw injection, `Proxy.revocable`, or alias can coexist while the gate passes.
5. **Medium — Missing event context can fail open for armed Prewalk.** The adapter substitutes `{}` and ambient `process.cwd()`; a successful tool result can consume an armed handoff without an authenticated session context.

TC-002: CONTRADICTED.
TC-015: CONTRADICTED.

Verdict: changes_requested.
