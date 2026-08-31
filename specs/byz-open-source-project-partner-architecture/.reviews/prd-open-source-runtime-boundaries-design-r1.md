---
at: 2026-08-30T07:50:37-07:00
reviewer: codex-cli
independent: true
scope:
  - specs/byz-open-source-project-partner-architecture/1.open-source-runtime-boundaries/requirements.md
  - specs/byz-open-source-project-partner-architecture/1.open-source-runtime-boundaries/design.md
  - packages/byz/package.json
  - packages/byz/scripts/build.mjs
  - packages/byz/src/conversation/conversation-extension.js
---

# Design review findings

1. **High — release attestation could be forged in-repository.** A contributor-controlled marker cannot prove human license review. Bind approval to the reviewed commit and require a protected CI environment, trusted signature, or equivalent authorization boundary.
2. **Medium — build failure could leave mixed generated roots.** `docs`, `examples`, and `workflows` are published outside `dist`; staging only `dist` is insufficient. Stage and validate the complete package image before pack, without deleting live roots first.
3. **Medium — atomic preference rename still loses concurrent field updates.** Serialize read-modify-write under a cross-process lock or use revision/CAS.

Disposition: all three findings accepted and applied to requirements/design.
