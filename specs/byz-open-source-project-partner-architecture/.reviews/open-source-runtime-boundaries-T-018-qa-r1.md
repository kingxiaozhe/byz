---
at: 2026-08-30T21:00:00-07:00
feature: 1.open-source-runtime-boundaries
task: T-018
mode: logic_commands
verdict: passed
case_count: 5
passed: 5
failed: 0
blocked: 0
---

# T-018 QA

## TC-007 — PASS

The production fixture compiles a dynamically added nested source module, publishes it into an immutable image, and resolves workspace entry points through `current` while image metadata references `dist/**`.

## TC-008 — PASS for T-018 scope

Production orchestration preserves complete old or promoted generations across contention, compiler failure, post-promotion ownership uncertainty, and malformed `current` states. The full BYZ suite passed 139/139 and the real package build completed.

## TC-009 — PASS for T-018 scope

Output, workflow, owner-election, stale-owner, post-activation `unknown`, and publication fencing regressions remain green.

## TC-010 — PASS

Portable conflict checks reject exact, case, Unicode/invalid-segment, runtime-tree, runtime-asset, duplicate, and non-adjacent ancestor aliases. Post-rename `unknown` reports `promoted-unconfirmed` and preserves the current generation.

## TC-011 — PASS

An external JavaScript symlink inside `src` is rejected before generation creation or compiler execution; the generation list and previous `current` remain unchanged.

Verification: targeted build tests passed 19/19 in QA, previously passed 20 consecutive stability rounds, BYZ package tests passed 139/139, production build passed, and `npm run check` passed. Coverage was not collected by the Node test command.
