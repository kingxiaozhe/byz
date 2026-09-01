# T-002 pre-task boundary

- Baseline HEAD: `bf20830461ed4e99ba921b7da6293b6f58e47f23`
- Delivery: `diff`; no stage, commit or push.
- `packages/byz/src/conversation/conversation-extension.js` was clean at T-002 start.
- `packages/byz/test/conversation.test.mjs` contained only the content-bound T-001 red regressions.
- `packages/byz/src/adapters/pi/pi-runtime-adapter.ts` and `packages/byz/test/architecture.test.mjs` already contained uncommitted Trusted CM Recovery Card changes. T-002 adopts neither ownership nor review credit for those bytes; task-only diffs are computed from their recorded pre-task copies.
- No dependency, lockfile, workflow, recovery, diagnostics or CLI files are assigned to T-002.
