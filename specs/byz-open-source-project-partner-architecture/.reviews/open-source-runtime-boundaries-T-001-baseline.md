# T-001 Baseline Verification

- Baseline commit: `4952f8a97be6e6efe709aab0ac217d0a7b58c800`
- Branch: `main`
- Pre-task dirty status SHA-256: `87c1908b8009555e2574c427abd9a88796827898e9471d6e7d03c13bd5decf29`
- Pre-existing dirty paths: `prd/prd-byz-open-source-project-partner-architecture.md`, `specs/byz-open-source-project-partner-architecture/`

## Results

| Command | Result | Summary |
| --- | --- | --- |
| `./test.sh` | PASS | Non-E2E workspace regression exited 0; coding-agent summary included 238 files/1991 tests passed, evals 23 passed, protocol 147 passed, server 50 passed, telemetry 15 passed, sqlite-node 87 passed, and TUI completed successfully. |
| `npm --prefix packages/byz test` | PASS | 120/120 tests passed. |
| `node --test scripts/byz-release.test.mjs scripts/byz-packed-runtime.test.mjs scripts/check-byz-public-package.test.mjs` | PASS | 13/13 release, packed-runtime, workflow-lock, and public-package checks passed. |

No product source or behavior was changed by this task.
