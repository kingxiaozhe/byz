# Footer reftable test timeout

## Symptom

The reftable debounce test intermittently timed out while the release smoke test ran the full repository suite in parallel.

## Reproduction

The failure occurred in `./test.sh`; the isolated file passed, identifying a load-sensitive test timeout rather than a functional branch-detection failure.

## Root cause

The test allowed three seconds for an operating-system file watcher event. Under full-suite contention, event delivery could exceed that test-only deadline.

## Fix

Increase the polling helper's test timeout to ten seconds. Production debounce and watcher behavior remain unchanged. Replacing the watcher integration with mocks was rejected because this test intentionally covers real filesystem notifications.

## Impact and regression

Scope is limited to test tolerance. The targeted file passed 8/8, `npm run check` passed, and `./test.sh` passed with coding-agent at 1991 passed and 50 skipped.
