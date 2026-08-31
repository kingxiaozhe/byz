---
at: 2026-08-30T10:20:59-07:00
reviewer: codex-cli
independent: true
task: T-012
attempt: 1
round: 1
verdict: changes_requested
blocking_findings: 5
handoff: open-source-runtime-boundaries-T-012-a1-handoff.json
handoff_sha256: 1d78a45d66341ebd0bfa627a2b5d9a88bfd46468c3daa6541a13c95b6309e549
scope:
  - packages/byz/scripts/build-support.mjs
  - packages/byz/test/build-safety.test.mjs
---

# Findings

1. High: stale takeover renames whichever pointer currently occupies `build.lock`, so a delayed contender can displace a newly active owner.
2. High: package image publication is not fenced by lease ownership and an expired owner can still replace `current`.
3. High: output-root validation retains only a pathname, leaving replacement races after the initial no-follow check.
4. High: interruption while directly creating `build.lock` can leave a malformed pointer that all later acquisitions reject.
5. Medium: workflow destination uniqueness is case-sensitive and does not reject portable trailing-dot/space aliases.

TC-009: CONTRADICTED.

Disposition: accepted for attempt 2. The lock pointer will be removed in favor of atomically visible owner directories and deterministic contender/preemption rules; publication will run through the lease fence; output identity will be revalidated through critical operations; workflow aliases and interruption cases will receive dynamic tests.
