---
at: 2026-08-31T07:56:00-07:00
reviewer: codex-cli
independent: true
task: T-022
attempt: 2
round: 2
verdict: blocked
blocking_findings: 3
handoff: open-source-runtime-boundaries-T-022-a2-handoff.json
handoff_sha256: a55b8e80adbad766e35a72731b0606445a79e32531ab8374565cb4eec4a71b89
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
  - packages/byz/test/fast-switch.test.mjs
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

1. **High — Architecture gate still accepts obvious aliases and alternate raw escapes.** A canonical feature call can coexist with `const mount = conversationExtension; mount(pi)` without being counted. Computed `globalThis["Proxy"]`, accessor `get raw()` and `{ context: pi }` also evade the current AST predicates, so raw Pi can re-enter a feature while the gate passes.
2. **High — Module-global model branding accepts references from another live session.** After session B initializes its Fast context, an adapter-branded reference obtained from session A resolves through B's registry by provider/id and is accepted by `B.fast.setModel()`. Branding proves only that some adapter created the object, not that it belongs to the same session/reload lineage.
3. **Medium — Project trust can be lost during the final asynchronous Prewalk path check.** Trust is checked before awaited `realpath()` work but not after it; revocation during that window still allows the Fast handoff.

TC-002: CONTRADICTED.
TC-015: CONTRADICTED.

The five first-round concerns were otherwise substantially closed: Prewalk no longer receives model/registry, Fast listeners are UI-only, reload restoration works in one lineage, nested tool args are projected, missing event context fails, and dependency/lock declarations are correct.

Round 2 is blocked. CM policy forbids attempt 3 without a replacement task and renewed specification approval.
