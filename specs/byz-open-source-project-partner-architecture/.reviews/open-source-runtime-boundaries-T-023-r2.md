---
at: 2026-09-02T21:10:00-07:00
reviewer: codex-cli
independent: true
task: T-023
attempt: 2
round: 2
verdict: blocked
blocking_findings: 3
handoff: open-source-runtime-boundaries-T-023-a2-handoff.json
handoff_sha256: 0bc0d18db3320c35ff8dc75be0652fc31afbd63d965b2f3f1605c3d57216112e
scope:
  - packages/byz/scripts/check-architecture.mjs
  - packages/byz/src/adapters/pi/pi-runtime-adapter.ts
  - packages/byz/src/application/ports/runtime.ts
  - packages/byz/src/fast-session.js
  - packages/byz/src/prewalk.js
  - packages/byz/test/architecture.test.mjs
  - packages/byz/test/fast-switch.test.mjs
  - packages/byz/test/prewalk.test.mjs
---

# Findings

1. **P2 — Verify the source binding of injected ports.** A local `ports` binding can be shadowed or reassigned to `{ conversation: pi }`; `conversationExtension(ports.conversation)` passes because the checker validates only spelling, not that the symbol resolves to the specific result of `createPiExtensionPorts(pi)`.
2. **P2 — Resolve feature creators behind namespace access.** A namespace import such as `features.createConversationExtension()` is not classified because creator resolution accepts only identifiers. Keeping the normal tracked instance satisfies the count while the namespace-created extension can still receive raw Pi.
3. **P2 — Detect raw escapes written with `Reflect.set`.** `Reflect.set(facade, "api", pi)` creates the same forbidden property as direct assignment but is not rejected because the mutation detector recognizes only `defineProperty`.

The runtime lineage, Fast reload, Prewalk trust race, container aliases and direct/static raw writes are otherwise substantially closed. Round 2 remains blocked; CM policy forbids attempt 3.

## Logic-case disposition

- TC-002: `CONTRADICTED` — shadowed ports and namespace factory creation still bypass the static boundary.
- TC-003: `SUPPORTED` — managed-resource capability behavior remains unchanged.
- TC-015: `CONTRADICTED` — a shadowed port source can still inject raw Pi.
- TC-016: `CONTRADICTED` — the hostile matrix lacks the three reproduced round-two variants.
