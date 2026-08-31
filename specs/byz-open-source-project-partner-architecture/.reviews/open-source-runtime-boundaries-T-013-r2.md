---
at: 2026-08-30T17:56:45-07:00
reviewer: codex-cli
independent: true
task: T-013
attempt: 2
round: 2
verdict: blocked
blocking_findings: 2
handoff: open-source-runtime-boundaries-T-013-a2-handoff.json
handoff_sha256: c02347fe7fca5b7f329ad4ffc47db492f4fb94a5950ac82fe7c6828d0a8ca6b7
scope:
  - packages/byz/package.json
  - packages/byz/scripts/build.mjs
  - packages/byz/test/build.test.mjs
---

# Blocking findings

1. High: compiled-output collision checks compare reserved runtime paths case-sensitively. On a case-insensitive filesystem, a differently cased BYZ source output can evade validation and be overwritten by Pi runtime assets.
2. High: if publication changes `current` and the post-operation ownership fence then fails, `buildByzPackage` still treats the generation as unpublished and deletes it, leaving `current` dangling.

TC-007: CONTRADICTED.
TC-008 (T-013 slice): CONTRADICTED.
TC-009 (T-013 slice): CONTRADICTED.

Round 2 is blocked. CM policy forbids attempt 3 without human resolution.
