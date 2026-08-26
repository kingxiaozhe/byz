# BYZ

BYZ is a business-first coding agent by Zero, built on the Pi coding-agent
runtime. The command is `byz`; user configuration is stored under `.byz` rather
than `.pi`.

Status: bootstrap development. The CLI runtime is being established before the
independent `cm-workflow` and `cm-plugin-workflow` adapters are enabled.

## Development

```bash
npm ci --ignore-scripts
npm run build:byz
node packages/byz/dist/cli.js --version
node packages/byz/dist/cli.js --help
```

BYZ preserves Pi's MIT-licensed runtime and records the exact upstream baseline
in `upstream.json`.
