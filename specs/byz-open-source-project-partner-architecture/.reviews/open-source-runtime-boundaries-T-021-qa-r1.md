---
at: 2026-08-31T03:41:00-07:00
tester: local
independent: false
task: T-021
round: 1
verdict: passed
blocking_cases: 2
passed_cases: 2
failed_cases: 0
blocked_cases: 0
mutation_captured: 1/1
---

# T-021 QA

## TC-003 — PASS

Command selected the real workflow integration cases for managed command capability, ordinary-extension denial, multi-owner preservation, empty replacement, forged token and wrong-owner rejection.

Result: 3/3 selected cases passed. N4 static verdict: SUPPORTED.

## TC-014 — PASS

Commands verified:

- ordinary Pi discovered-before-additional default and explicit `before` for skills/prompts;
- startup managed-theme rejection before sibling resources;
- actual `session.reload()` rollback of loader catalogs, runner, tools, prompt state and extension lifecycle;
- dynamic BYZ excludes static precedence while the static branch explicitly enables it.

Result: 4/4 selected cases passed. N4 static verdict: SUPPORTED.

## Mutation self-proof

An isolated coding-agent copy changed the default `additionalResourcePrecedence` from `after` to `before`. The focused regression failed at the expected default-Pi collision assertion, receiving the additional skill where the discovered skill was required.

Mutation result: 1/1 captured. The first two fixture starts were operationally invalid because the isolated copy lacked shared Vitest/workspace links; both were corrected before counting the mutation result.

## Acceptance criteria

- AC-004: passed.
- AC-005: passed.
- AC-019: passed.

Coverage instrumentation was not collected. Conclusion: PASSED.
