---
at: 2026-08-30T08:06:03-07:00
reviewer: codex-cli
independent: true
scope:
  - specs/byz-open-source-project-partner-architecture/4.community-extension-platform/requirements.md
  - specs/byz-open-source-project-partner-architecture/4.community-extension-platform/design.md
  - specs/byz-open-source-project-partner-architecture/4.community-extension-platform/tasks.md
  - packages/byz/scripts/build.mjs
---

# Split review findings

1. Artifact identity task omitted version/commit, manifest, dependency closure and permission tuple details. Expanded it and added parameterized invalidation coverage.
2. Official BYZ examples could be overwritten by the current Pi examples build path. Added a prerequisite package-image staging task that deterministically merges both sets.
3. One supply-chain task combined npm, Git, local, dependency locking and tree hashing. Split common materialization, npm resolution, and Git/local resolution while retaining the 15-task limit.

Disposition: all three findings accepted; tasks, dependencies, and test contract updated.
