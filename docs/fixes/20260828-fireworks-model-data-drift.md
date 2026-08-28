# Fireworks model-data drift

## Symptom

PR #16 passed its BYZ packed-runtime regression, build, and static checks, but GitHub Actions failed in `packages/ai/test/fireworks-models.test.ts` because the test expected a Fireworks `-turbo` router that was no longer present after hydrating the current models.dev catalog.

Red evidence:

```text
AssertionError: expected undefined to be defined
packages/ai/test/fireworks-models.test.ts:45:17
```

## Reproduction

Hydrate the current model catalog through `npm run build:byz`, then run the Fireworks model test. The generated catalog contains no matching `accounts/fireworks/routers/*-turbo` entry, so the fixed-existence assertion fails.

## Root cause

The test treated one models.dev catalog entry as a permanent BYZ contract even though Fireworks models are generated from a mutable upstream catalog and the product has no fallback that guarantees this router.

## Fix

Remove the obsolete Fire Pass turbo-router existence test and its now-unused `getModels` import. Existing tests continue to cover the supported Fireworks Anthropic API configuration, current Fast routers, compatibility flags, and session-affinity behavior.

Rejected alternatives:

- Do not add a fallback model: that would expose a model the upstream catalog no longer advertises.
- Do not make the assertion conditional: a test that skips all assertions when the model is absent would be a placebo.
- Do not substitute another fixed router: current Fast router behavior is already covered by dedicated GLM and Kimi tests.

## Impact and regression

Affected surface: one obsolete test contract. Runtime behavior, model generation, BYZ workflows, package versions, and publishing behavior are unchanged.

Verified with:

- `npm run build:byz` using the current models.dev catalog
- `node "$(git rev-parse --show-toplevel)/node_modules/vitest/dist/cli.js" --run test/fireworks-models.test.ts` from `packages/ai` (14 tests passed)
- `npm run check`
- `PATH="/Users/zero/.pi/agent/bin:$PATH" ./test.sh`

PR #16 GitHub Actions remains the final remote verification gate.
