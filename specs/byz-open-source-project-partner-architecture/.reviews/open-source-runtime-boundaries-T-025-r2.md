---
at: 2026-09-02T21:34:30-07:00
reviewer: codex-cli
independent: true
task: T-025
attempt: 2
round: 2
verdict: blocked
blocking_findings: 3
handoff: open-source-runtime-boundaries-T-025-a2-handoff.json
handoff_sha256: 16ec64545f7ff54f8222e9cb2911b427c1769feada150a071c81b7e4c873e9f8
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

1. **P1 — Follow re-export aliases to the feature creator.** `export { createConversationExtension as makeConversation }` followed by `const rogue = makeConversation(); rogue(pi)` is not tracked because creator classification checks the importing spelling instead of resolving the original export symbol.
2. **P1 — Reject raw escapes created with `Reflect.defineProperty`.** `Reflect.defineProperty(facade, "raw", { value: pi })` is a standard reflective raw-property write but the adapter gate currently recognizes only `Object.defineProperty` and `Reflect.set`.
3. **P2 — Verify import provenance before classifying creators.** An unrelated local module exporting a same-named `createConversationExtension` is classified as the BYZ feature solely from the imported spelling, creating a false composition violation and duplicate count.

The attempt-1 Windows path and resolved local-name false positives are closed, and the runtime lineage/Prewalk changes remain sound. Round 2 is nevertheless blocked; CM policy forbids attempt 3.

## Logic-case disposition

- TC-002: `CONTRADICTED` — import provenance is not source-bound through re-exports.
- TC-003: `SUPPORTED` — managed-resource behavior remains unchanged.
- TC-015: `CONTRADICTED` — a reflective raw facade escape remains.
- TC-016: `CONTRADICTED` — creator provenance can both miss a raw injection and reject unrelated code.
