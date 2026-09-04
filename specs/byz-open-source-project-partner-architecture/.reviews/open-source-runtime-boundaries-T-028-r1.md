---
at: 2026-09-03T02:00:00-07:00
reviewer: codex-cli
independent: true
task: T-028
attempt: 1
round: 1
verdict: changes_requested
blocking_findings: 5
handoff: open-source-runtime-boundaries-T-028-a1-handoff.json
handoff_sha256: 4ee6d6073bcfb6710c2bd176b060c62036221f005fed6ee3039ad2a4fbb2057e
scope:
  - packages/byz/src/conversation/conversation-controller.js
  - packages/byz/src/conversation/conversation-preferences.js
  - packages/byz/src/conversation/language-catalog.js
  - packages/byz/test/conversation-preferences.test.mjs
  - packages/byz/test/conversation.test.mjs
---

# Verdict

Changes requested.

1. Cell-directory replacement can redirect pathname-based temp creation and publication.
2. Revision metadata is not CAS; same-field writers can both report success at one revision and destination replacement is not rejected.
3. First-time directory creation is not fsynced in its containing parent.
4. Repeated corrupt reads create unlimited forensic copies.
5. Tests lack deterministic same-field, directory/destination replacement, first-create durability and repeated-corruption coverage.

The independent-cell design itself was accepted as solving different-field overwrite and zombie shared locks.
