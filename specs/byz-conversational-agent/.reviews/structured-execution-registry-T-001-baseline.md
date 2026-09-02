# T-001 baseline and red-test evidence

- Prestate: `structured-execution-registry-prestate.md`
- Focused pre-change baseline: `node --test packages/byz/test/conversation.test.mjs packages/byz/test/architecture.test.mjs` — 40 passed, 0 failed.
- BYZ package pre-change baseline: `npm --prefix packages/byz test` — 216 passed, 0 failed, 1 skipped.
- Added red contracts:
  - pure registry plan/reducer/append/replay/deep-freeze behavior;
  - managed execution tool, bounded lifecycle evidence and provenance;
  - Adapter capability and Session custom-entry boundary;
  - Conversation compact/completion rendering and unsafe snapshot omission.
- Red command: `node --test packages/byz/test/execution-registry.test.mjs packages/byz/test/execution-extension.test.mjs packages/byz/test/conversation.test.mjs packages/byz/test/architecture.test.mjs` — expected failure, 40 passed and 5 failed because execution modules/port/rendering do not yet exist.
- Repository check after test edits: `npm run check` passed; Biome formatted the two new test files.
- Product source behavior was not modified.
