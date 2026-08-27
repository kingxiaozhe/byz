# BYZ

BYZ is a business-first coding agent by Zero, built on the Pi coding-agent
runtime. The command is `byz`; user configuration is stored under `.byz` rather
than `.pi`.

Status: initial public release. `cm-workflow` and `cm-plugin-workflow` are
locked to full Git commits and bundled as independent workflow roots. CM loads
by default; CM Plugin loads only when explicitly selected.

## Install and update

Install the current public package from npm:

```bash
npm install -g --ignore-scripts @aibyzero/byz
byz --version
byz
```

An npm-managed global installation updates through BYZ's own npm release
channel:

```bash
byz update
```

This command updates only `@aibyzero/byz`. It never calls Pi's release channel,
promotes the Pi source baseline, or updates workflow packages independently.
When a new CM or CM Plugin version is accepted into BYZ, it ships in a new BYZ
version. Users receive it through the same `byz update` command.

Workflows do not have an end-user update or rollback command. Every BYZ release
selects one CM version and one compatible CM Plugin version; users run the
versions selected by their installed BYZ release.

## Workflows

```bash
byz workflow list
byz workflow check cm
byz workflow check cm-plugin
byz --workflow cm
byz --workflow cm-plugin
byz --workflow none
```

BYZ loads at most one workflow per session. Users do not install, update, or
roll back either workflow separately. Local development can override package
roots with `BYZ_CM_WORKFLOW_ROOT` or
`BYZ_CM_PLUGIN_WORKFLOW_ROOT`; the two roots must remain distinct.

## Development

```bash
npm ci --ignore-scripts
npm run build:byz
node packages/byz/dist/cli.js --version
node packages/byz/dist/cli.js --help
```

BYZ preserves Pi's MIT-licensed runtime and records the exact upstream baseline
in `upstream.json`. Workflow versions, source commits, licenses, and bundle
boundaries are recorded in `workflows.lock.json`.

Repository maintainers inspect a clean workflow checkout, then explicitly apply
its version and Pi resource manifest to the next BYZ release branch:

```bash
npm run byz:sync-cm -- --root /path/to/cm-workflow
npm run byz:sync-cm -- --root /path/to/cm-workflow --apply

npm run byz:sync-cm-plugin -- --root /path/to/cm-plugin-workflow
npm run byz:sync-cm-plugin -- --root /path/to/cm-plugin-workflow --apply
```

These repository commands never commit, push, open a pull request, tag, or
publish. Both commands refresh the root lockfile with lifecycle scripts
disabled and pin the selected workflow to its full Git commit.

## Releasing BYZ

BYZ releases are independent from Pi's lockstep release scripts. From a built
checkout, validate the single-package release contract without publishing:

```bash
npm run build:byz:offline
npm run release:byz -- --tag byz-v0.1.1
```

The dedicated GitHub Actions workflow publishes only `packages/byz` when an
explicit matching `byz-v*` tag is pushed from `main`. The npm trusted publisher
must be bound to `.github/workflows/byz-release.yml` before the first tag is
pushed. Do not run the root Pi `release:*` commands for a BYZ release.

Rollback does not delete an npm version. If a release is broken, move npm's
`latest` dist-tag back to the last verified BYZ version, then publish a forward
patch after the fix passes the same gates.

## Upgrading the Pi base

This is a repository-maintainer operation. It is not an end-user BYZ update
command.

From a clean `main` that exactly matches `origin/main`, check the latest stable
Pi tag without changing the checkout:

```bash
npm run byz:upgrade-pi
```

An explicit target can also be inspected without applying it:

```bash
npm run byz:upgrade-pi -- --to v0.85.0
```

After reviewing that target, create a local upgrade branch, merge Pi, update
`upstream.json`, and run the required verification gates:

```bash
npm run byz:upgrade-pi -- --to v0.85.0 --apply
```

When the target changes dependency metadata, the inspection output adds an
explicit authorization flag. Review the target first, then run the exact
suggested command, for example:

```bash
npm run byz:upgrade-pi -- --to v0.85.0 --apply --allow-lockfile-change
```

`--to` accepts an upstream tag or a full 40-character commit SHA. The apply
flow refuses dirty, divergent, downgraded, unrelated, or non-upstream targets.
It never pushes, opens a PR, merges `main`, publishes BYZ, or resolves conflicts.
On a conflict, resolve it on the generated `upgrade/pi-*` branch or run
`git merge --abort`.

Pi upgrade PRs must be merged with a real merge commit so Git retains Pi's
upstream ancestry. Do not squash these PRs. This exception does not change the
merge policy for normal BYZ feature PRs.
