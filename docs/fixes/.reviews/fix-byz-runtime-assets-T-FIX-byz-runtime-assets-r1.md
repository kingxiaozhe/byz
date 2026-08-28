---
at: 2026-08-27T06:15:00-07:00
reviewer: codex-subagent
independent: true
task: T-FIX-byz-runtime-assets
attempt: 1
round: 1
verdict: changes_requested
blocking_findings: 1
handoff: fix-byz-runtime-assets-T-FIX-byz-runtime-assets-a1-handoff.json
handoff_sha256: 6d92915c37c19225be5ff4183f6ca5aafa49d3feffe5f59e09d56556d9d9cddb
scope:
  - .github/workflows/byz-release.yml
  - docs/fixes/.reviews/fix-byz-runtime-assets-cause-r1.md
  - docs/fixes/20260827-byz-runtime-assets.md
  - packages/byz/CHANGELOG.md
  - packages/byz/scripts/build.mjs
  - packages/byz/test/smoke.test.mjs
  - scripts/byz-packed-runtime.test.mjs
---

## P1: Linux TUI startup marker does not survive ANSI styling

The initial independent source review reported zero findings, but GitHub CI run `33074584969` invalidated that approval. The installed TUI started successfully and rendered BYZ plus bundled CM resources, while the regression waited for the plain substring `byz v`. ANSI styling separates those tokens in captured Linux output, so the test timed out after a successful startup.

Required change: detect a stable post-initialization message that is not split by styling, then rerun the content-bound review and Linux CI.

## Previously reviewed implementation

The build copies exactly Pi's existing nine-file runtime asset contract into the installed package-root paths without changing Pi path resolution, BYZ update semantics, workflow contents, or publication behavior.

The package-level regression covers all nine paths. The release-boundary regression packs and installs BYZ outside the repository, exercises HTML export on every supported host, and starts the installed TUI through a pseudo-terminal on Linux CI. The macOS manual tmux smoke independently confirmed interactive startup and bundled CM resource loading.

No private workflow source data or new external dependency is introduced.
