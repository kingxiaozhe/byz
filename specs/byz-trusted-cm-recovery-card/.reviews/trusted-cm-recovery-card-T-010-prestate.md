# T-010 pre-task boundary

- Branch: `main`
- Delivery: `diff`; no stage, commit, branch, push or MR.
- Existing product paths are untracked leftovers from dropped T-002 and are explicit T-010 inputs:
  - `packages/byz/src/recovery/recovery-state.js` — `5e453c6cd4ff93514147698d1e6cef4a46c4990dfde37f0817a5da62d65803b0`
  - `packages/byz/test/recovery-state.test.mjs` — `dc7a95be6b3d656d272ca6e499454cbeac8fcc8bdb5b94350e03db2d8f7d12ee`
- Other pre-existing untracked paths excluded from the implementation diff:
  - `prd/prd-byz-trusted-cm-recovery-card.md`
  - `specs/byz-trusted-cm-recovery-card/`
- Focused pre-task characterization: `node --test packages/byz/test/recovery-state.test.mjs` passed 6/6.
- T-002 review evidence is historical input only. T-010 starts attempt 1.
