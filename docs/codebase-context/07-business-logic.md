# 关键业务逻辑

## Pi agent execution

**线路**：CLI entry (`packages/coding-agent/src/cli.ts`) → mode selection (`packages/coding-agent/src/modes/**`) → session runtime (`packages/coding-agent/src/core/agent-session*.ts`) → model runtime (`packages/coding-agent/src/core/model-runtime.ts`) → provider adapter (`packages/ai/src/api/**`) → tool execution (`packages/coding-agent/src/core/tools/**`).

**关键规则**：

- Tool mutations must remain inside trusted project boundaries and use existing path guards.
- Keybindings are configurable; do not hardcode key checks. Add defaults to keybinding defaults instead.
- Prompt/templates/skills are loaded from configured resource roots; do not assume one user-level install path.

## BYZ workflow lifecycle

**线路**：BYZ CLI (`packages/byz`) → workflow selection/list/check → bundled workflow roots → Pi baseline runtime → release scripts (`scripts/byz-*.mjs`, `scripts/release.mjs`).

**关键规则**：

- BYZ owns command routing, workflow selection, product update path, and compatibility with selected CM/CM Plugin versions.
- BYZ does not provide an independent permission sandbox; keep security language aligned with README.
- Workflow versions are selected by BYZ release artifacts; end users do not update CM independently.

## Model metadata generation

**线路**：generator (`packages/ai/scripts/generate-models.ts`) → provider data hydration → generated catalogs (`packages/ai/src/models.generated.ts`, providers data) → model resolver/runtime.

**关键规则**：

- Never edit `packages/ai/src/models.generated.ts` directly.
- Update generator scripts and regenerate so generated output stays reproducible.

## Release flow

**线路**：changelog audit → local release smoke → `npm run release:{patch|minor}` → generated artifacts/checks/commits/tags → GitHub Actions publish/announce.

**关键规则**：

- Lockstep versioning across public Pi packages; BYZ has its own package version in `packages/byz/package.json`.
- Do not rerun release script after tag push for the same version.
