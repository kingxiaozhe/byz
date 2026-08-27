# BYZ release model-data hydration

## Symptom

The first `byz-v0.1.0` GitHub Actions run failed in `Build BYZ` before packaging or npm publication. `packages/ai` reported that `src/providers/data/amazon-bedrock.json` was missing and instructed the caller to run `npm run hydrate:model-data`.

## Reproduction

Run the BYZ release workflow from a clean checkout. The workflow installs dependencies and immediately runs `npm run build:byz:offline`; ignored generated model data is absent, so `check:model-data` fails.

The regression assertion added to `scripts/byz-release.test.mjs` failed before the fix because `.github/workflows/byz-release.yml` did not contain `npm run hydrate:model-data`.

## Root cause

The BYZ release workflow used the offline build contract without first hydrating the generated model data required by that contract.

## Fix

Reuse the repository's existing release preparation command, `npm run hydrate:model-data`, after dependency installation and before `npm run build:byz:offline`.

Rejected alternative: switching to the online build command would refresh the same data implicitly, but would weaken the explicit prepare-then-offline-build release boundary.

## Impact and regression

Affected surface: the BYZ GitHub Actions release workflow only. BYZ runtime behavior, package contents, update behavior, and bundled workflow versions are unchanged.

Verified with:

- `node --test scripts/byz-release.test.mjs`
- `npm run hydrate:model-data`
- `npm run build:byz:offline`
- `npm --prefix packages/byz test`
- `node --test scripts/byz-release.test.mjs scripts/check-byz-public-package.test.mjs`
- `npm run check`
