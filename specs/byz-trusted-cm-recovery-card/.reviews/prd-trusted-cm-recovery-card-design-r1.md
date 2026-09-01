---
at: 2026-08-31T09:09:17-07:00
reviewer: codex-cli
independent: true
stage: design
feature: trusted-cm-recovery-card
verdict: changes_requested
blocking_findings: 6
scope:
  - 1.trusted-cm-recovery-card/requirements.md
  - 1.trusted-cm-recovery-card/design.md
  - docs/prd-byz-trusted-cm-recovery-card.md
  - packages/byz/src/application/ports/runtime.ts
  - packages/byz/src/adapters/pi/pi-runtime-adapter.ts
  - packages/byz/src/cli.js
  - packages/byz/src/conversation/conversation-extension.js
  - packages/byz/src/diagnostics/schema.js
  - packages/coding-agent/src/core/project-trust.ts
  - packages/coding-agent/src/core/extensions/types.ts
  - packages/coding-agent/src/core/session-manager.ts
---

# Findings

1. **P0 blocker — Git status can execute project-controlled fsmonitor and may write the index.** Fixed argv and `shell: false` do not stop `core.fsmonitor`; the design also lacks optional-lock suppression. Require an inert Git configuration/environment contract or make Git unavailable.
2. **P0 blocker — the safe-read architecture overclaims cross-platform prevention.** Ancestor lstat/realpath plus final-component `O_NOFOLLOW` and post-read checks can detect an ancestor race only after bytes were consumed, and Windows behavior is underspecified. Define the supported primitive/threat boundary and narrow the acceptance guarantee to something implementable.
3. **P0 blocker — session trust is checked after materialization.** The proposed RecoveryContext eagerly computes `session.hasHistory`, so the Pi adapter may traverse Session entries before the extension handler checks trust. Projection must remain lazy and perform an adapter-level trust check before Session access.
4. **P0 blocker — completed CM PRD runs awaiting approval would disappear.** The locator accepts only running runs, while `cm-prd` writes `awaiting_review` and then `run_done`. Eligibility must include authoritative terminal runs with unresolved lifecycle work.
5. **P0 blocker — recorded review frontmatter is not proof that approval remains content-bound.** CM approval also requires current source bytes to match `implementation_sha256`. Because this feature forbids source reads, review evidence must be labelled historical/unrevalidated and cannot independently justify a current completion or mark-done claim.
6. **High blocker — readable global index with no candidate can hide a real active run created during mirror degradation.** Bounded project fallback must run when the index yields zero validated candidates, not only when the index file is missing/corrupt.

All six findings are accepted for design correction. No finding requires broad T-022 cleanup.

Verdict: changes_requested
