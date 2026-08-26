# BYZ

BYZ is a business-first coding agent by Zero, built on the Pi coding-agent
runtime. The command is `byz`; user configuration is stored under `.byz` rather
than `.pi`.

Status: bootstrap development. The public `cm-workflow` package is bundled and
loaded by default. The private `cm-plugin-workflow` package remains separately
installed and is available only to users with repository access.

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
