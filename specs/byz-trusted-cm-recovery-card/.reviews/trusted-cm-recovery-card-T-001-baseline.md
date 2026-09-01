# T-001 Baseline

- Recorded at: 2026-08-31T09:50:00-07:00
- HEAD: `bf2083046`
- Branch: `main`
- Pre-task dirty boundary: untracked `prd/prd-byz-trusted-cm-recovery-card.md` and `specs/byz-trusted-cm-recovery-card/`; tracked diff SHA-256 was the empty-diff hash `e3b0c442…b855`.
- No product source or test file changed by this task.

## Results

| Command | Result | Evidence |
| --- | --- | --- |
| `./test.sh` | PASS on rerun | All non-E2E workspace suites passed. First run had one pre-existing timing-only failure in `footer-data-provider.test.ts`; immediate focused rerun passed, then the full command passed with coding-agent 1994/1994 tests and all other workspace suites green. |
| `cd packages/coding-agent && node "$(git rev-parse --show-toplevel)/node_modules/vitest/dist/cli.js" --run test/footer-data-provider.test.ts` | PASS | Exact focused rerun for the initial footer timeout passed. |
| `npm --prefix packages/byz test` | PASS | 151/151 tests passed. |
| `node --test packages/byz/test/architecture.test.mjs packages/byz/test/conversation.test.mjs packages/byz/test/workflow-switch.test.mjs` | PASS | 37/37 tests passed. |
| `cd packages/coding-agent && node "$(git rev-parse --show-toplevel)/node_modules/vitest/dist/cli.js" --run test/trust-manager.test.ts test/trust-selector.test.ts test/extensions-runner.test.ts` | PASS | 44/44 tests passed across trust-manager, trust-selector and extensions-runner. |
| `node --test packages/byz/test/smoke.test.mjs` | PASS | 32/32 CLI identity, workflow and mode-routing smoke tests passed. |
| `cd packages/coding-agent && node "$(git rev-parse --show-toplevel)/node_modules/vitest/dist/cli.js" --run test/interactive-product-profile.test.ts` | PASS | 2/2 ordinary-Pi product-profile tests passed. |
| `test ! -e packages/byz/src/recovery && ! rg -n 'RecoveryPort|createRecovery' packages/coding-agent/src` | PASS | Before implementation, BYZ had no recovery source tree and ordinary Pi contained no RecoveryPort or recovery factory. This is the explicit pre-feature comparison point for TC-010. |
| `node --test scripts/byz-packed-runtime.test.mjs` | PASS | 1/1 packed-runtime smoke test passed outside the repository. |

## Baseline classification

The first full-run footer debounce timeout is a recovered, pre-implementation flaky baseline event: no tracked files differed before or after it, its focused rerun passed, and the complete full suite passed on the next run. It is not attributed to this feature. Any recurrence after implementation must still be reported and compared against this baseline rather than silently ignored.

## TC-010 baseline

TC-010 is supported as a pre-feature baseline, not as proof of the future implementation: ordinary Pi retains its default startup profile; existing BYZ CLI/workflow/mode routing tests pass; the packed runtime starts in a repository-external non-CM directory; and no recovery source, port or factory exists before this feature. T-005 and T-007 must rerun and extend these exact comparison points after RecoveryPort and composition are added.
