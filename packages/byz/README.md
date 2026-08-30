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

## Local diagnostics

BYZ records a small, structured diagnostic stream on the local machine to help identify failures, slow operations, and update regressions. Diagnostics never upload automatically and never record prompts, model responses, code, file paths, tool arguments or output, credentials, headers, or provider payloads.

```bash
byz diagnostics status
byz diagnostics summary
byz diagnostics doctor
byz diagnostics disable
byz diagnostics enable
byz diagnostics record --for 30m
byz diagnostics record --stop
byz diagnostics clear --confirm
```

Runtime recording is best effort: it uses a bounded queue and per-process shards. Full queues, disk errors, invalid records, and writer failures drop diagnostics instead of delaying or changing the main BYZ flow. Events are retained for 30 days with a 100 MB default limit.

Create a local aggregate-only support bundle after reviewing its preview:

```bash
byz diagnostics export
byz diagnostics export --confirm
```

The export contains a manifest, aggregate summary, and privacy report. It does not contain raw events and is never uploaded or added to model context automatically.

When sufficient comparable samples exist, `diagnostics summary` can show a trend across a BYZ update. The result is correlation-only, requires at least 20 samples on each side, and never triggers rollback or remote reporting.

## Interactive timing

During an interactive turn, BYZ updates the working indicator once per second with the current stage and elapsed time. When the turn completes, one summary shows time spent in each stage, total active execution time, time waiting for confirmation, and total elapsed time.

Confirmation wait is reported separately and is not counted as agent execution. Timing is turn-local, uses a monotonic clock, and is not written to the session, diagnostics, or model context.

The interactive footer shows the current effective Thinking level next to the model. Shift+Tab, `/thinking`, Fast, and model capability changes update it immediately without `/reload`.

## Fast mode

Use Fast mode for lower-latency, lower-token everyday work without removing the
selected workflow's skills, prompts, context, or quality gates:

```bash
byz --fast
byz --fast --workflow cm-plugin
```

Fast mode uses Pi's existing runtime controls and defaults thinking to `low`.
Set an optional model once when a separate fast model is available:

```bash
export BYZ_FAST_MODEL="provider/model"
byz --fast
```

An explicit `--model` or `--thinking` option always wins. Continuing or resuming
an existing session keeps that session's model and applies the Fast thinking
default. Normal `byz` runs ignore `BYZ_FAST_MODEL` and remain unchanged.

Inside an interactive session, Fast can be changed without restarting BYZ or
starting a new conversation:

```text
/fast
/fast on
/fast off
/fast status
```

`/fast on` snapshots the current model and thinking, then applies the same Fast
defaults. `/fast off` restores that snapshot. The active workflow, conversation,
session, skills, prompts, and tools do not change. Explicitly selecting a model
or thinking level exits Fast and keeps that explicit choice. BYZ rejects Fast
state changes while the agent is running, and an unavailable or unauthenticated
configured model leaves the current state unchanged.

## Prewalk

Arm a one-time handoff when the current model should understand the task and perform the first successful workspace edit before Fast continues:

```text
/prewalk
/prewalk status
/prewalk cancel
```

`/prewalk` is available only in an interactive, trusted, idle session. It resolves and authenticates the same target used by Fast before arming. If `BYZ_FAST_MODEL` is unset, the current authenticated model remains selected and only thinking changes to `low` after the handoff.

Only the first successful Pi built-in `edit` or `write` whose real target remains inside the current workspace consumes the armed state. Read-only tools, failed writes, extension tools with the same name, and file or directory symlink escapes do not trigger it. Parallel tool results are checked serially and can consume the state only once.

Prewalk preserves the current conversation, session, workflow, skills, prompts, and tools. It does not add another model call for planning. An explicit model or thinking selection cancels an armed Prewalk and keeps the user's choice. Enabling Fast also cancels it; Prewalk refuses to arm when Fast is already active.

## Workflows

```bash
byz workflow list
byz workflow check cm
byz workflow check cm-plugin
byz --workflow cm
byz --workflow cm-plugin
byz --workflow none
```

Inside an interactive session, `/workflow` shows the active workflow.
`/workflow cm`, `/workflow cm-plugin`, and `/workflow none` switch it in place
without starting a new conversation or calling the model. BYZ validates the
target before replacing its managed skills and prompts, does not reload
unrelated extensions, and rejects switching while the agent is running.

BYZ loads at most one workflow at a time. Users do not install, update, or roll
back either workflow separately. Local development can override package roots
with `BYZ_CM_WORKFLOW_ROOT` or
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
