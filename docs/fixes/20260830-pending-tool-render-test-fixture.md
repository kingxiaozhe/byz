# Pending tool render regression fixture

## Symptom

`4167-thinking-toggle-pending-tool-render.test.ts` failed both pending and completed tool rendering assertions during release smoke testing.

## Reproduction

```bash
node "$(git rev-parse --show-toplevel)/node_modules/vitest/dist/cli.js" --run test/suite/regressions/4167-thinking-toggle-pending-tool-render.test.ts
```

Both tests failed before the fix.

## Root cause

The test's partial `InteractiveMode` fixture did not define the newer `toolExecutionVisible` state. JavaScript treated the missing value as false, so the production renderer skipped every tool component.

## Fix

Set `toolExecutionVisible: true` in the fixture, matching the production default. Changing production rendering was rejected because production behavior was correct.

## Impact and regression

Scope is limited to the regression fixture. The targeted test passed 2/2 after the fix, `npm run check` passed, and `./test.sh` passed with coding-agent at 1991 passed and 50 skipped.
