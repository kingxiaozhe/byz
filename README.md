<p align="center">
  <img src="./assets/readme/hero.svg" alt="BYZ — Business first. Tooling handled." width="1200">
</p>

<p align="center">
  <strong>English</strong> · <a href="./README.zh-CN.md">简体中文</a>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@aibyzero/byz"><img alt="npm version" src="https://img.shields.io/npm/v/%40aibyzero%2Fbyz?style=flat-square&color=F5B942&labelColor=09111F"></a>
  <a href="./packages/byz/package.json"><img alt="Node.js 22.19 or newer" src="https://img.shields.io/badge/node-%3E%3D22.19.0-F5B942?style=flat-square&labelColor=09111F"></a>
  <a href="./LICENSE"><img alt="MIT license" src="https://img.shields.io/badge/license-MIT-F5B942?style=flat-square&labelColor=09111F"></a>
</p>

<p align="center">
  <strong>BYZ is Zero's business-first coding agent: one command, isolated workflows, and a traceable Pi foundation.</strong>
</p>

<p align="center">
  <a href="#start-here">Start here</a> ·
  <a href="#workflow-isolation">Workflows</a> ·
  <a href="#one-update-path">Updates</a> ·
  <a href="#built-on-pi">Built on Pi</a> ·
  <a href="./packages/byz/README.md">Full reference</a>
</p>

## Start here

Install the public npm package and start BYZ:

```bash
npm install -g --ignore-scripts @aibyzero/byz
byz --version
byz workflow check cm
byz
```

BYZ stores its user configuration under `.byz`, not `.pi`. CM and CM Plugin are bundled, so neither workflow has a separate installation step.

## What BYZ handles

| You focus on | BYZ keeps explicit |
| --- | --- |
| The business goal and product behavior | Which managed workflow is active |
| Implementation and verification | Workflow versions selected by the BYZ release |
| Shipping useful software | The exact Pi source baseline underneath |
| Your own project configuration | An isolated `.byz` runtime boundary |

BYZ is intentionally a thin product layer. It does not try to replace every tool. It provides one stable entry point and owns the compatibility decisions around that entry point.

## Workflow isolation

<p align="center">
  <img src="./assets/readme/workflow-boundaries.svg" alt="BYZ selects one isolated managed workflow per session: CM, CM Plugin, or none." width="1200">
</p>

BYZ loads at most one managed workflow per session:

| Selection | Availability | Behavior |
| --- | --- | --- |
| `cm` | Public and bundled | Default; uses the CM version shipped by the installed BYZ release |
| `cm-plugin` | Public, bundled, and opt-in | Uses the CM Plugin version shipped by BYZ; selected explicitly |
| `none` | Always available | Starts the base runtime without a managed workflow |

```bash
byz workflow list
byz workflow check cm
byz workflow check cm-plugin
byz --workflow cm
byz --workflow cm-plugin
byz --workflow none
```

CM and CM Plugin use separate package roots, and BYZ does not cross-load them. See the [full workflow reference](./packages/byz/README.md#workflows) for development overrides.


## One update path

<p align="center">
  <img src="./assets/readme/release-contract.svg" alt="The byz update command installs one BYZ release with its selected workflow versions and Pi baseline." width="1200">
</p>

```bash
byz update
```

`byz update` updates only the npm-managed global `@aibyzero/byz` installation. It does not call Pi's release channel and it does not update CM or CM Plugin independently.

Each BYZ release selects its compatible CM version, CM Plugin contract, and Pi baseline. Maintainers change those selections while developing a new BYZ version; users receive the resulting set through the next BYZ release. There is no end-user workflow-only update or rollback command.

Release contract in this source tree:

| Component | Selected version | Distribution |
| --- | --- | --- |
| BYZ | See `packages/byz/package.json` | Public npm package |
| CM Workflow | `0.10.4` | Bundled with BYZ |
| CM Plugin Workflow | `0.5.0` | Bundled with BYZ |
| Pi coding-agent baseline | `0.84.3` | Pinned source foundation |

## Built on Pi

BYZ is built on the MIT-licensed [Pi coding agent](https://pi.dev/) and preserves its upstream Git history. The exact source commit and coding-agent version are recorded in [`packages/byz/upstream.json`](./packages/byz/upstream.json); workflow versions and bundle boundaries are recorded in [`packages/byz/workflows.lock.json`](./packages/byz/workflows.lock.json).

BYZ changes the product boundary, command, configuration root, workflow lifecycle, and release channel. It does not hide its foundation or pretend the runtime was built from zero.

### Security boundary

Like Pi, BYZ runs with the permissions of the process that starts it. It does not provide a built-in permission sandbox. For untrusted work, use an operating-system account, container, or another isolation boundary. Pi's [containerization guide](./packages/coding-agent/docs/containerization.md) describes one option.

## Development

The repository keeps Pi as the source base and develops BYZ changes through focused feature branches and reviewed pull requests.

```bash
npm ci --ignore-scripts
npm run hydrate:model-data
npm run build:byz:offline
npm --prefix packages/byz test
npm run check
```

Maintainer-only operations for synchronizing CM and CM Plugin, upgrading the Pi baseline, and releasing BYZ are documented in [`packages/byz/README.md`](./packages/byz/README.md). Those commands inspect or prepare repository changes; they do not give end users independent workflow update channels.

Before contributing, read [`CONTRIBUTING.md`](./CONTRIBUTING.md) and the repository's [`AGENTS.md`](./AGENTS.md).

## License

BYZ is released under the [MIT License](./LICENSE). The Pi-derived runtime and preserved upstream history remain under their original MIT terms.
