# Changelog

## Unreleased

## 0.1.1 - 2026-08-27

### Added

- Established the BYZ distribution package on a pinned Pi upstream baseline.
- Added the `byz` CLI identity and isolated `.byz` configuration directory.
- Bundled the pinned public CM Workflow so users do not install or update it separately.
- Added an opt-in, separately pinned CM Plugin Workflow installation that remains outside the public package.
- Added `byz update`, which reads only the BYZ npm release channel and updates only `@aibyzero/byz`.
- Added maintainer-only commands for reviewing and applying Pi base upgrades and CM workflow revisions.
- Added a BYZ-only npm release workflow with tag, package identity, tarball, private-source, and external-install gates.
