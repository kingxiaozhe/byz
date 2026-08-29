# Changelog

## Unreleased

## 0.1.7 - 2026-08-29

### Added

- Added same-session routing and collaboration preferences that classify common requests, inject minimal per-turn guidance, and show route details only on demand.
- Added the default BYZ conversation shell with a goal-first welcome, low-noise progress, on-demand details, and natural-language confirmation input.

### Changed

- Changed the default interactive shell to hide internal resources, tool rows, model metadata, and advanced controls until requested.

## 0.1.6 - 2026-08-28

### Added

- Added same-session `/fast` hot switching with reversible model and thinking state, explicit user choices taking priority, and no changes to the active workflow or conversation ([#22](https://github.com/kingxiaozhe/byz/pull/22)).
- Added opt-in `/prewalk` one-time handoff after the first successful built-in workspace edit or write, reusing the authenticated Fast target without changing the conversation or workflow ([#23](https://github.com/kingxiaozhe/byz/pull/23)).

## 0.1.5 - 2026-08-28

### Fixed

- Made `byz workflow status` report the effective workflow when no target is given, distinguish active and available `none` states, and avoid unrelated workflow-root checks for `none` ([#20](https://github.com/kingxiaozhe/byz/pull/20)).

## 0.1.4 - 2026-08-27

### Added

- Added same-session `/workflow` hot switching between the bundled CM Workflow, CM Plugin Workflow, and no managed workflow while preserving conversation, model, thinking, Fast Mode, and unrelated host resources ([#18](https://github.com/kingxiaozhe/byz/pull/18)).

## 0.1.3 - 2026-08-27

### Added

- Added opt-in Fast Mode with the complete selected workflow, `thinking=low` by default, optional `BYZ_FAST_MODEL`, and explicit model or thinking options taking precedence ([#15](https://github.com/kingxiaozhe/byz/pull/15)).

### Fixed

- Made BYZ's bundled workflow skills and prompts win same-name host collisions while continuing to load unrelated host resources ([#16](https://github.com/kingxiaozhe/byz/pull/16)).

## 0.1.2 - 2026-08-27

### Added

- Bundled the pinned public CM Plugin Workflow with BYZ, keeping CM and CM Plugin independently selectable while preventing separate end-user installation or updates ([#12](https://github.com/kingxiaozhe/byz/pull/12)).

### Fixed

- Restored the package-root runtime assets required by the installed TUI and HTML exporter.

## 0.1.1 - 2026-08-27

### Added

- Established the BYZ distribution package on a pinned Pi upstream baseline.
- Added the `byz` CLI identity and isolated `.byz` configuration directory.
- Bundled the pinned public CM Workflow so users do not install or update it separately.
- Added an opt-in, separately pinned CM Plugin Workflow installation that remains outside the public package.
- Added `byz update`, which reads only the BYZ npm release channel and updates only `@aibyzero/byz`.
- Added maintainer-only commands for reviewing and applying Pi base upgrades and CM workflow revisions.
- Added a BYZ-only npm release workflow with tag, package identity, tarball, private-source, and external-install gates.
