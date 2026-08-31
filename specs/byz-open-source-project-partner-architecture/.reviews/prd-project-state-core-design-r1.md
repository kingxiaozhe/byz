---
at: 2026-08-30T07:50:37-07:00
reviewer: codex-cli
independent: true
scope:
  - specs/byz-open-source-project-partner-architecture/2.project-state-core/requirements.md
  - specs/byz-open-source-project-partner-architecture/2.project-state-core/design.md
  - packages/session-backends/sqlite-node/src/sqlite/migrations.ts
  - packages/coding-agent/src/core/project-trust.ts
  - packages/coding-agent/src/core/trust-manager.ts
---

# Design review findings

1. **High — repository methods accepted public projectId without an enforced access capability.** Require opaque `VerifiedProjectAccess` for every private-state read and mutation; keep raw repository private.
2. **High — canonical path alone cannot distinguish a legitimate worktree from a copied projectId.** Store and verify a project-level repository anchor such as canonical Git common-dir identity.
3. **High — per-migration transactions can leave a partially migrated database.** Apply the complete batch to a private copy, validate it, then atomically promote; retain versioned read-only exporters.
4. **High — delete races with append/open.** Use a versioned deleting tombstone, exclusive fenced lease, rejection of new access, and resumable DeleteReport.

Disposition: all four findings accepted and applied to requirements/design.
