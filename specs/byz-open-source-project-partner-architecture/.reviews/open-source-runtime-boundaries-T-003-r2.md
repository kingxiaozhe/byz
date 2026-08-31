---
at: 2026-08-31T01:45:00-07:00
reviewer: codex-cli
independent: true
task: T-003
attempt: 2
round: 2
verdict: blocked
blocking_findings: 2
handoff: open-source-runtime-boundaries-T-003-a2-handoff.json
handoff_sha256: cf87b2480d26838ddec3b81e0176a86b85e96e8e4346b28ecfee35a98b2dfe90
scope:
  - packages/byz/src/cli.js
  - packages/byz/src/workflow-switch.js
  - packages/byz/test/diagnostics.test.mjs
  - packages/byz/test/workflow-switch.test.mjs
  - packages/coding-agent/src/core/agent-session.ts
  - packages/coding-agent/src/core/extensions/index.ts
  - packages/coding-agent/src/core/extensions/runner.ts
  - packages/coding-agent/src/core/extensions/types.ts
  - packages/coding-agent/src/core/resource-loader.ts
  - packages/coding-agent/src/index.ts
  - packages/coding-agent/src/main.ts
---

# Blocking findings

1. Product-specific precedence leaked globally: `mergeDiscoverableResourcePaths()` now always lets additional resources precede auto-discovered resources, changing ordinary Pi behavior instead of restricting `before` precedence to managed-owner configuration.
2. Managed startup `themePaths` are silently removed from the ordinary set and then omitted from the managed set. Command-time theme replacement rejects correctly, but startup discovery still succeeds without applying or rejecting the theme.

The three round-1 findings are closed: multi-owner replacement preserves other snapshots, theme replacement rejects before mutation, empty-discovery owners bind, and project-trust preloading retains capability identity.

TC-003: SUPPORTED for capability isolation, but F-004/module-4 remain blocked by the two lifecycle findings.

Round 2 is blocked. CM policy forbids attempt 3 without human resolution.
