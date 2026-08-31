---
at: 2026-08-30T22:28:13-07:00
reviewer: codex-cli
independent: true
task: T-019
attempt: 1
round: 1
verdict: changes_requested
blocking_findings: 6
handoff: open-source-runtime-boundaries-T-019-a1-handoff.json
handoff_sha256: ea7e8f5fbceabf579f9297742a690a7db70a8084680a0f7f3e541ef9d789fc2f
scope:
  - .github/workflows/byz-release.yml
  - packages/byz/scripts/artifact.mjs
  - packages/byz/scripts/build.mjs
  - packages/byz/scripts/pack.mjs
  - packages/byz/scripts/verify-artifact.mjs
  - scripts/byz-packed-runtime.test.mjs
  - scripts/byz-release.mjs
  - scripts/byz-release.test.mjs
---

# Blocking findings

1. High: a forged coherent receipt can omit current-image files because publish validates only receipt-listed entries and never independently derives the complete npm package manifest.
2. High: capture checks compressed size before streaming but does not stop if the same inode grows beyond the hard limit during capture.
3. High: release dry-run emits no receipt and is not bound to the generation/artifact later used by CI.
4. High: publish does not assert ownership after synchronous npm publish and ignores a false lock-release result, so lock loss can still report success.
5. Medium: the tar parser accepts dangling PAX/GNU metadata, non-zero padding, and regular-file headers ending in `/`, allowing verifier/consumer disagreement.
6. Medium: destination-retarget and executable publish/lock-loss regressions do not exercise the required deterministic boundaries.

TC-008 (T-019 slice): CONTRADICTED.
TC-012: CONTRADICTED.

Verdict: changes_requested.
