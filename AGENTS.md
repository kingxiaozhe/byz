# Development Rules

## Project Context

- Project: `pi-monorepo`, a BYZ product layer on a Pi-derived TypeScript coding-agent monorepo.
- Stack: Node.js `>=22.19.0`, npm workspaces, TypeScript/JavaScript ESM, Biome, tsgo, Vitest, Node test.
- Version control: `remote` git repository with `origin` and `upstream`; protect other sessions' unstaged/untracked work.
- CM runtime: `both`, preset `codex-codes` (source: user-level default); declared in `.cm-workflow.yml`. This is an automatic-dispatch preference, not permission to call another provider.
- Codebase map: existing `docs/codebase-context/` baseline is 2026-08-29; this initialization did not refresh it because the map inventory failed with `init_scan_limit` (10,000 directory entries). Verify relevant code before relying on the map.
- Verification scope: command declarations and file references are checked against current manifests/source; install, builds, full tests, interactive/provider calls and release execution remain unverified in this initialization. `npm run check` includes `biome check --write` and can modify files.
- Release lines: Pi packages share one lockstep version (currently `0.84.3`). `@aibyzero/byz` is released independently (currently `0.1.13`) and is held out of the Pi release path by `INDEPENDENT_PACKAGES` in `scripts/package-workspaces.mjs`. The root `pi-monorepo` version (`0.0.3`) is private and never published. See the Releasing section for which command belongs to which line; `packages/byz/README.md` and `.github/workflows/byz-release.yml` document the BYZ path.
- Delivery shape: CLI/TUI desktop tooling plus BYZ workflow packaging.
- Install: `npm ci --ignore-scripts`; local dependency refresh: `npm install --ignore-scripts`.
- Development entry points: `./pi-test.sh` for interactive Pi smoke testing; BYZ build/test commands live under `packages/byz`.
- Build: `npm run build`; BYZ release build: `npm run build:byz`; offline BYZ build: `npm run build:byz:offline`.
- Check/lint/typecheck: `npm run check`.
- Tests: use `./test.sh` for non-e2e regression unless a narrower package command is specified below.
- Key directories: `packages/ai`, `packages/agent`, `packages/coding-agent`, `packages/tui`, `packages/protocol`, `packages/client`, `packages/server`, `packages/session-backends/sqlite-node`, `packages/byz`, `scripts`, `docs`.
- Safety boundary: no hardcoded secrets; run npm installs with `--ignore-scripts`; treat lockfiles and shrinkwraps as reviewed code.
- Compatibility rules: when relevant, read `.claude/rules/coding-style.md`, `.claude/rules/testing.md`, `.claude/rules/security.md`, `.claude/rules/git-workflow.md`, `.claude/rules/backend-api.md`, and `.claude/rules/database.md`.


## Conversational Style

- Keep answers short and concise
- No emojis in commits, issues, PR comments, or code
- No fluff or cheerful filler text (e.g., "Thanks @user" not "Thanks so much @user!")
- Technical prose only, be direct
- Use concise, clear, simple language. Define unavoidable jargon before using it.
- Explain non-trivial designs and problems as: problem, concrete example or short trace, then solution. State why the solution is necessary and distinguish it from optional complexity.
- Prefer concrete behavior and small illustrations over abstract summaries, dense terminology, or unexplained lists of changes.
- When the user asks a question, answer it first before making edits or running implementation commands.
- When responding to user feedback or an analysis, explicitly say whether you agree or disagree before saying what you changed.

## Code Quality

- Read files in full before wide-ranging changes, before editing files you have not fully inspected, and when asked to investigate or audit. Do not rely on search snippets for broad changes.
- No `any` unless absolutely necessary.
- Inline single-line helpers that have only one call site.
- Check node_modules for external API types; don't guess.
- **No inline imports** (`await import()`, `import("pkg").Type`, dynamic type imports). Top-level imports only.
- Never remove or downgrade code to fix type errors from outdated deps; upgrade the dep instead.
- Use only erasable TypeScript syntax (Node strip-only mode) in code checked by the root config (`packages/*/src`, `packages/*/test`, `packages/coding-agent/examples`): no parameter properties, `enum`, `namespace`/`module`, `import =`, `export =`, or other constructs needing JS emit. Use explicit fields with constructor assignments.
- Always ask before removing functionality or code that appears intentional.
- Do not preserve backward compatibility unless the user asks for it.
- Never hardcode key checks (e.g. `matchesKey(keyData, "ctrl+x")`). Add defaults to `DEFAULT_EDITOR_KEYBINDINGS` or `DEFAULT_APP_KEYBINDINGS` so they stay configurable.
- Never modify `packages/ai/src/models.generated.ts` directly; update `packages/ai/scripts/generate-models.ts` instead, then regenerate. Including the resulting `models.generated.ts` diff is always OK, even if regeneration includes unrelated upstream model metadata changes.

## Commands

- After code changes (not docs): `npm run check` (full output, no tail). Fix all errors, warnings, and infos before committing. Does not run tests.
- Never run `npm run build` or `npm test` unless requested by the user.
- Never run the full vitest suite directly: it includes e2e tests that activate when endpoint/auth env vars are present. For all non-e2e tests, run `./test.sh` from the repo root. Otherwise run specific tests from the package root:
  - Vitest: `node "$(git rev-parse --show-toplevel)/node_modules/vitest/dist/cli.js" --run test/specific.test.ts`
  - `packages/tui` (`node:test`): `node --test test/specific.test.ts`
- If you create or modify a test file, run it and iterate on test or implementation until it passes.
- For `packages/coding-agent/test/suite/`, use `test/suite/harness.ts` + the faux provider. No real provider APIs, keys, or paid tokens.
- When regressions tests for fixing a github issue, add a comment with the github issue number next to the test.
- For ad-hoc scripts, `write` them to a temp file (e.g. `/tmp`), run, edit if needed, remove when done. Don't embed multi-line scripts in `bash` commands.
- Never commit unless the user asks.

## Dependency and Install Security

- Treat npm dep and lockfile changes as reviewed code. Direct external deps stay pinned to exact versions.
- When updating `undici`, you MUST read its changelog/release notes for the target version and evaluate whether any changes may affect functionality before applying the update.
- Hydrate/update locally with `npm install --ignore-scripts`; clean/CI-style with `npm ci --ignore-scripts`. Don't run lifecycle scripts unless the user asks.
- If dep metadata changes, refresh `package-lock.json` with `npm install --package-lock-only --ignore-scripts`.
- If `packages/coding-agent/npm-shrinkwrap.json` needs regen, run `node scripts/generate-coding-agent-shrinkwrap.mjs` (verify with `--check` or `npm run check`). New deps with lifecycle scripts require review and an explicit allowlist entry in that script; never add one silently.
- Pre-commit blocks lockfile commits unless `PI_ALLOW_LOCKFILE_CHANGE=1`. Don't bypass unless the user wants the lockfile change committed.

## Git

Multiple pi sessions may be running in this cwd at the same time, each modifying different files. Git operations that touch unstaged, staged, or untracked files outside your own changes will stomp on other sessions' work. Follow these rules:

Committing:

- Only commit files YOU changed in THIS session.
- Stage explicit paths (`git add <path1> <path2>`); never `git add -A` / `git add .`.
- Before committing, run `git status` and verify you are only staging your files.
- `packages/ai/src/models.generated.ts` may always be included alongside your files.
- Message format: `{feat,fix,docs}[(ai,tui,agent,coding-agent)]: <commit message> (optionally multiple lines)`. Message is informative and concise.

Never run (destroys other agents' work or bypasses checks):

- `git reset --hard`, `git checkout .`, `git clean -fd`, `git stash`, `git add -A`, `git add .`, `git commit --no-verify`.

If rebase conflicts occur:

- Resolve conflicts only in files you modified.
- If a conflict is in a file you did not modify, abort and ask the user.
- Never force push.

## Issues and PRs

See `CONTRIBUTING.md` for the contributor gate (auto-close workflows, `lgtm`/`lgtmi`, quality bar).

When reviewing PRs:

- Do not run `gh pr checkout`, `git switch`, or otherwise move the worktree to the PR branch unless the user explicitly asks.
- Use `gh pr view`, `gh pr diff`, `gh api`, and local `git show`/`git diff` against fetched refs to inspect PR metadata, commits, and patches without changing branches.
- If you need PR file contents, fetch/read them into temporary files or use `git show <ref>:<path>` without switching branches.

When creating issues:

- Add `pkg:*` labels for affected packages (`pkg:agent`, `pkg:ai`, `pkg:coding-agent`, `pkg:tui`); use all that apply.

When posting issue/PR comments:

- Write the comment to a temp file and post with `gh issue/pr comment --body-file` (never multi-line markdown via `--body`).
- Keep comments concise, technical, in the user's tone.
- End every AI-posted comment with the AI-generated disclaimer line specified by the originating prompt (e.g. `This comment is AI-generated by `/wr``).

When closing issues via commit:

- Include `fixes #<number>` or `closes #<number>` in the message so merging auto-closes the issue. For multiple issues, repeat the keyword per issue (`closes #1, closes #2`); a shared keyword (`closes #1, #2`) only closes the first.

## Testing pi Interactive Mode with tmux

For testing pi's interactive mode, load and follow [.pi/skills/interactive-testing.md](.pi/skills/interactive-testing.md).

## Changelog

Location: `packages/*/CHANGELOG.md` (one per package).

Sections under `## [Unreleased]`: `### Breaking Changes` (API changes requiring migration), `### Added`, `### Changed`, `### Fixed`, `### Removed`.

Rules:

- All new entries go under `## [Unreleased]`. Read the full section first and append to existing subsections; never duplicate them.
- Released version sections (e.g. `## [0.12.2]`) are immutable; never modify them.
- Do not create changelog entries when working on a branch other than `main` or pull request

Attribution:

- Internal (from issues): `Fixed foo bar ([#123](https://github.com/earendil-works/pi/issues/123))`
- External contributions: `Added feature X ([#456](https://github.com/earendil-works/pi/pull/456) by [@username](https://github.com/username))`

## Releasing

This repository has two independent release lines. Pick the right one before running anything.

| Line | Packages | Version command | Release command | Tag |
| --- | --- | --- | --- | --- |
| Pi | every `@earendil-works/pi-*` package | `npm run version:{patch,minor,major}` | `npm run release:{patch,minor,major}` | `vX.Y.Z` |
| BYZ | `@aibyzero/byz` only | edit `packages/byz/package.json` by hand | push a `byz-vX.Y.Z` tag | `byz-vX.Y.Z` |

Never use a Pi release command to ship BYZ, or the reverse. The Pi tooling reads its package set from `INDEPENDENT_PACKAGES` in `scripts/package-workspaces.mjs` and skips BYZ in the lockstep version check (`scripts/sync-versions.js`), the version bump (`scripts/version-lockstep.mjs`), the publish set (`scripts/release-packages.mjs`) and the changelog sweep (`scripts/release.mjs`). Adding another independently released package means adding its name to that one set.

### Pi release line

For release preparation, publishing, verification, or recovery, load and follow [.pi/skills/release.md](.pi/skills/release.md).

**Lockstep versioning**: all Pi packages share one version; every release updates all together. `patch` = fixes + additions, `minor` = breaking changes. No major releases.

1. **Update CHANGELOGs**: ask the user whether they ran the `/cl` prompt on the latest commit on `main`. If not, they must run `/cl` first to audit and update each package's `[Unreleased]` section before releasing.

2. **Local smoke test**: build an unpublished release and smoke test from outside the repo (so it can't resolve workspace files):
   ```bash
   npm run release:local -- --out /tmp/pi-local-release --force
   cd /tmp

   # Node package install smoke tests
   /tmp/pi-local-release/node/pi --help
   /tmp/pi-local-release/node/pi --version
   /tmp/pi-local-release/node/pi --list-models
   /tmp/pi-local-release/node/pi -p "Say exactly: ok"
   /tmp/pi-local-release/node/pi

   # Bun binary smoke tests
   /tmp/pi-local-release/bun/pi --help
   /tmp/pi-local-release/bun/pi --version
   /tmp/pi-local-release/bun/pi --list-models
   /tmp/pi-local-release/bun/pi -p "Say exactly: ok"
   /tmp/pi-local-release/bun/pi
   ```
   Verify both Node and Bun startup, model/account listing, interactive startup, and at least one real prompt with the intended default provider. The bare commands `/tmp/pi-local-release/node/pi` and `/tmp/pi-local-release/bun/pi` start interactive mode; run each in tmux, submit a prompt, and wait for the model reply before considering the interactive smoke test passed. Failures are release blockers unless the user explicitly accepts the risk.

3. **Run the release script**:
   ```bash
   PI_ALLOW_LOCKFILE_CHANGE=1 npm_config_min_release_age=0 npm run release:patch    # fixes + additions
   PI_ALLOW_LOCKFILE_CHANGE=1 npm_config_min_release_age=0 npm run release:minor    # breaking changes
   ```
   Use `npm_config_min_release_age=0` only for the release command. The repo's normal npm age gate can otherwise block the release lockfile refresh when the current workspace package version was published recently. Review any lockfile or shrinkwrap diffs the release creates before push.

   The release script bumps all package versions, updates changelogs, regenerates release artifacts, runs `npm run check`, commits `Release vX.Y.Z`, tags `vX.Y.Z`, adds fresh `## [Unreleased]` changelog sections, commits `Add [Unreleased] section for next cycle`, then pushes `main` and the tag. Do not rerun the release script after a tag was pushed.

4. **CI verifies and announces the npm release**: pushing the `vX.Y.Z` tag triggers `.github/workflows/build-binaries.yml`. The `publish-npm` job uses npm trusted publishing through GitHub Actions OIDC with environment `npm-publish`; no local `npm publish`, `npm whoami`, OTP, or WebAuthn flow is required. After publishing, `announce-pi-dev-release` verifies every public workspace package resolves at the exact release version and that its npm tarball is available, then writes the verified release marker to R2. `pi.dev/api/latest-version` reads that marker; it must never announce a release from npm before this job succeeds.

5. **If CI publish or announcement fails**: inspect the failed job. The publish helper is idempotent and skips package versions already present on npm; the announcement job rechecks availability before updating the R2 marker. Rerun the failed job or workflow after fixing CI or transient npm issues. Do not rerun `npm run release:patch` or `npm run release:minor` for the same version.

### BYZ release line

`@aibyzero/byz` ships on its own version line and its own tag. None of the Pi release commands above touch it, and it must never be released through them.

1. **Set the version**: edit `version` in `packages/byz/package.json` by hand. There is deliberately no `version:` script for BYZ; `npm run version:*` skips it and prints `Skipping @aibyzero/byz (independent release line).`

2. **Update `packages/byz/CHANGELOG.md`** under its `## [Unreleased]` section.

3. **Verify locally** before tagging:
   ```bash
   npm run build:byz
   npm --prefix packages/byz test
   npm --prefix packages/byz run check:architecture
   ```

4. **Tag and push** `byz-vX.Y.Z`, matching `packages/byz/package.json` exactly. `scripts/byz-release.mjs` rejects a tag whose version does not match the manifest, a tag that does not point at HEAD, and any publish attempted outside GitHub Actions.

5. **CI publishes**: the `byz-v*` tag triggers `.github/workflows/byz-release.yml`. It packs a dry-run artifact, records that artifact's generation identity and SHA-256, then publishes the same tarball via npm trusted publishing in the `npm-publish` environment. Never run `npm publish` for BYZ locally.

**Maintenance note**: each BYZ build leaves a ~30 MB package image under `packages/byz/.byz-output/generations/`, and nothing prunes the images that were promoted to `current`. They are gitignored, but they accumulate one per successful build. Delete every generation directory except the one `packages/byz/.byz-output/current` resolves to when the directory grows.

## User Override

If the user's instructions conflict with any rule in this document, ask for explicit confirmation before overriding. Only then execute their instructions.
