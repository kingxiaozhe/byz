# T-001 pre-task boundary

- Baseline HEAD: `bf20830461ed4e99ba921b7da6293b6f58e47f23`
- Delivery: `diff`; no stage, commit or push.
- Existing recovery-card changes in Adapter/runtime/architecture paths are excluded from T-001.
- `packages/byz/test/conversation.test.mjs` was clean at task start.
- Baseline command: `node --test packages/byz/test/conversation.test.mjs` — 14/14 passed.
- Post-change red gate: the two new current-turn usage regressions fail against existing product behavior; all pre-existing Conversation tests remain passing.
