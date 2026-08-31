---
at: 2026-08-31T00:31:00-07:00
role: cm-qa-engineer
mode: implementation
feature: 1.open-source-runtime-boundaries
task: T-020
result: passed
cases: 3
passed: 3
failed: 0
blocked: 0
coverage: not-collected
---

# T-020 QA

## Formal commands

- `npm --prefix packages/byz run build`: passed.
- `npm --prefix packages/byz test`: 139/139 passed.
- `node --test scripts/byz-release.test.mjs scripts/byz-packed-runtime.test.mjs scripts/check-byz-public-package.test.mjs`: 16/16 passed in the QA invocation.
- `npm run check`: passed with no fixes.
- Corrected release suite stability: 5/5 consecutive runs passed.

## Test contracts

- TC-008: PASS — production build, package tests, external packed-runtime smoke, public package checks, and receipt-bound release tests passed; broader clean-clone completion remains assigned to T-011.
- TC-012: PASS — private destination, tar limits, one-path replacement, paired tarball+receipt replacement, expected generation/SHA, and publish callback fencing are executable regressions.
- TC-013: PASS — release dry-run is the sole workflow producer, holds the process-identity lock, and rejects current switch or owner loss without delivering another candidate.

## Mutation proof

An isolated copied fixture disabled the expected dry-run identity comparison in `artifact.mjs`. The production-boundary release test failed with `Missing expected rejection`; mutation score: 1/1 detected. The fixture was removed and its resource lifecycle was logged.

## Acceptance criteria

- AC-014: passed and marked complete.
- AC-017: passed and marked complete.
- AC-018: passed and marked complete.
- AC-010/AC-011: not marked here because their remaining clean-clone/full-package scope is completed by T-011.

Conclusion: PASSED.
