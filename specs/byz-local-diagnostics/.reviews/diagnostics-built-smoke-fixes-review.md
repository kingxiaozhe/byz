# Built CLI Smoke Fixes — Independent Review

- Channel: fresh ephemeral read-only `codex-cli`
- Scope:
  - `packages/byz/src/diagnostics/diagnostics-extension.js`
  - `packages/byz/src/diagnostics/recorder.js`
  - corresponding regression tests in `packages/byz/test/diagnostics.test.mjs`
- Evidence supplied: built tmux first/second-start notice smoke, built `update --help` exit smoke, unit regressions.
- Findings: zero.
- Verdict: approved.
