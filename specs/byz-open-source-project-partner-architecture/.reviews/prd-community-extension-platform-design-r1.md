---
at: 2026-08-30T07:50:37-07:00
reviewer: codex-cli
independent: true
scope:
  - specs/byz-open-source-project-partner-architecture/4.community-extension-platform/requirements.md
  - specs/byz-open-source-project-partner-architecture/4.community-extension-platform/design.md
  - packages/coding-agent/src/core/package-manager.ts
  - packages/coding-agent/src/core/extensions/loader.ts
  - packages/byz/package.json
---

# Design review findings

1. **High — trusted code can bypass first-use confirmation with direct Node/OS I/O.** Scope enforcement claims to broker-mediated API actions and state this limitation in user warnings.
2. **High — top-level package integrity does not bind transitive executable code.** Lock the full dependency closure, isolate installation, compute executable tree digest, and bind grants to it.
3. **High — revocation races with pending-to-executing action claim.** Store grant generation with actions and validate it atomically during claim; revocation increments generation and cancels pending rows.
4. **Medium — deprecation inside a minor still allowed a same-minor removal.** Reject all breaking v1 changes within the minor; remove only in the next permitted minor with migration guidance.

Disposition: all four findings accepted and applied to requirements/design.
