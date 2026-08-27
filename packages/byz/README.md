# BYZ

BYZ is a business-first coding agent by Zero, built on the Pi coding-agent
runtime. The command is `byz`; user configuration is stored under `.byz` rather
than `.pi`.

Status: pre-release development. The public `cm-workflow` package is bundled and
loaded by default. The private `cm-plugin-workflow` package remains separately
installed and is available only to users with repository access.

## Install and update

After the first public package is published:

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
When a new public CM version is accepted into BYZ, it ships in a new BYZ
version. Users receive it through the same `byz update` command.

## Workflows

```bash
byz workflow list
byz workflow check cm
byz --workflow cm
byz --workflow none
```

CM Plugin stays private and is not included in the public BYZ package:

```bash
export BYZ_CM_PLUGIN_WORKFLOW_SOURCE='git:git@github.com:OWNER/PRIVATE_REPO@<40-character-commit-sha>'
byz workflow install cm-plugin
byz workflow check cm-plugin
byz --workflow cm-plugin
```

The private source is supplied by the authorized user and is never shipped in
BYZ's public lock file. `workflow install` requires a full commit SHA and stores
the package with Pi autoload disabled; BYZ injects it only when
`--workflow cm-plugin` is selected. BYZ therefore loads at most one managed
workflow per session. Local development can override package roots with
`BYZ_CM_WORKFLOW_ROOT` or
`BYZ_CM_PLUGIN_WORKFLOW_ROOT`; the two roots must remain distinct.

## Development

```bash
npm ci --ignore-scripts
npm run build:byz
node packages/byz/dist/cli.js --version
node packages/byz/dist/cli.js --help
```

BYZ preserves Pi's MIT-licensed runtime and records the exact upstream baseline
in `upstream.json`. Public workflow versions, source commits, licenses, and
bundle boundaries are recorded in `workflows.lock.json`. Private source identity
stays in the authorized user's `.byz` package configuration.

## Releasing BYZ

BYZ releases are independent from Pi's lockstep release scripts. From a built
checkout, validate the single-package release contract without publishing:

```bash
npm run build:byz:offline
npm run release:byz -- --tag byz-v0.1.0
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
