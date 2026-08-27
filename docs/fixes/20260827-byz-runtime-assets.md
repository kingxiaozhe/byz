# BYZ packaged runtime assets

## Symptom

An external installation of `@aibyzero/byz@0.1.1` passed version, help, and workflow checks, but interactive startup failed with:

```text
ENOENT: no such file or directory, open '.../@aibyzero/byz/dist/modes/interactive/theme/dark.json'
```

The installed package contained the file only at `dist/runtime/modes/interactive/theme/dark.json`. The same layout mismatch also affected interactive image and HTML export assets.

## Reproduction

Pack and install BYZ outside the repository, then start `byz --offline` in a terminal. Pi resolves the installed BYZ package root and reads runtime assets from package-root `dist/modes` and `dist/core` paths.

The first regression test failed before the fix at:

```text
ENOENT .../packages/byz/dist/modes/interactive/theme/dark.json
```

## Root cause

The BYZ build copied the entire Pi coding-agent output under `dist/runtime`, but Pi's existing asset contract resolves nine static files relative to package-root `dist`. Source builds hid the mismatch because the compiled runtime still retained its own nested asset copies.

## Fix

The BYZ build adapter now copies Pi's existing nine-file runtime asset contract from the built coding-agent output to the package-root locations expected by Pi:

- three interactive theme JSON files;
- the interactive image asset;
- three HTML export template files;
- two vendored HTML export scripts.

Rejected alternatives:

- A BYZ-specific fallback in Pi's generic path resolver would leak distribution concerns into the upstream base.
- Moving the complete Pi runtime out of `dist/runtime` would broaden the change and disturb BYZ's bundled entry points.
- Copying complete compiled directories would duplicate unnecessary JavaScript and source maps.

## Impact and regression

Affected surface: installed BYZ npm tarballs. Pi upstream behavior, BYZ workflow versions, update commands, and npm publication state are unchanged.

Verified with:

- red-to-green package-root asset contract: 1 expected failure became 26 passing BYZ tests;
- `npm run check`;
- `node --test scripts/byz-release.test.mjs scripts/byz-packed-runtime.test.mjs scripts/check-byz-public-package.test.mjs` (16 passing tests);
- real `npm pack` and temporary installation outside the repository;
- HTML export from the temporary installation;
- macOS tmux startup from the temporary installation, showing the BYZ TUI, bundled CM resources, and no asset `ENOENT`;
- Linux CI pseudo-terminal startup is enforced by `scripts/byz-packed-runtime.test.mjs`.

The temporary manual-smoke installation was moved to the macOS Trash after verification.
