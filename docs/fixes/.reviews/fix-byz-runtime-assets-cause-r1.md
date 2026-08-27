# BYZ runtime assets root-cause review

Verdict: changes_requested before implementation

## Findings

1. The observed failure is caused by BYZ placing Pi runtime assets under `dist/runtime` while Pi resolves installed-package assets from package-root `dist/modes` and `dist/core` paths.
2. The proposed BYZ build adapter is the correct and smallest ownership boundary. Pi's generic package path resolution should not gain a BYZ-specific fallback.
3. Pi's existing asset-copy contract contains exactly nine required files; no additional runtime assets were found.
4. A repository-build path assertion is insufficient. The regression must pack and install the tarball outside the repository, then exercise TUI theme initialization and HTML export.
5. Direct execution from the BYZ source package is a separate path because the package contains `src/`. This fix intentionally targets the published npm tarball contract.

## Required changes

- Copy the nine Pi runtime assets from the built coding-agent output to their package-root paths during the BYZ build.
- Add a real tarball installation regression for TUI startup and HTML export.
