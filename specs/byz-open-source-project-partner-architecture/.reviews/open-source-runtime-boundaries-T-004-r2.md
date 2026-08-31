---
at: 2026-08-31T05:10:00-07:00
reviewer: codex-cli
independent: true
task: T-004
attempt: 2
round: 2
verdict: blocked
blocking_findings: 1
handoff: open-source-runtime-boundaries-T-004-a2-handoff.json
handoff_sha256: a26b201d97a57fb48c1dab5140d08aafdd8be4d93dee776356cc953815783433
scope:
  - package-lock.json
  - package.json
  - packages/byz/CHANGELOG.md
  - packages/byz/package.json
  - packages/byz/scripts/check-architecture.mjs
  - packages/byz/src/adapters/pi/pi-runtime-adapter.ts
  - packages/byz/src/application/ports/runtime.ts
  - packages/byz/src/cli.js
  - packages/byz/test/architecture.test.mjs
  - packages/byz/test/prewalk.test.mjs
  - packages/coding-agent/CHANGELOG.md
  - packages/coding-agent/src/index.ts
  - packages/coding-agent/src/main.ts
  - packages/coding-agent/src/modes/index.ts
  - packages/coding-agent/src/modes/interactive/interactive-mode.ts
  - packages/coding-agent/test/interactive-product-profile.test.ts
---

# Blocking finding

The product profile, Pi Core naming cleanup, dependency gate, pinned lexer, root check integration and TC-002 are supported. However, `createPiExtensionAdapter()` is a transparent generic proxy that returns the complete Pi extension API. It does not construct the declared `RuntimePort`, `SessionPort`, `ModelPort`, `ManagedResourcePort` and `UiPort` facades or translate Pi lifecycle events. BYZ consumers therefore still depend on the full Pi context even though calls pass through an adapter-named object.

Input/state: a BYZ extension receives the adapter returned by `createPiExtensionAdapter()` and accesses any Pi-only capability not declared by BYZ ports.

Wrong result: the capability remains available through the proxy, so F-003's dependency direction is not enforced at the runtime boundary.

TC-002: SUPPORTED for the source dependency gate, but F-003/module 4 remain blocked.

Round 2 is blocked. CM policy forbids attempt 3 without human resolution.
