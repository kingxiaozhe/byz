# Workflow status semantics

## Symptom

`byz workflow status` exited with code 1 instead of reporting the effective workflow:

```text
Unknown workflow: <missing>. Expected cm, cm-plugin, or none.
```

Selecting `none` did not isolate the status query from unrelated CM roots. With overlapping local CM roots, `byz --workflow none workflow status` failed with:

```text
Workflow isolation violation: cm and cm-plugin roots overlap.
```

## Reproduction

On the clean BYZ 0.1.4 `main` baseline:

```text
env -u BYZ_WORKFLOW HOME=<isolated-home> node packages/byz/dist/cli.js workflow status
```

The new regression cases were then run before the implementation change. The focused smoke test reported 28 passed and 3 failed; the failures were the missing effective target, unrelated root validation for `none`, and the corresponding help contract.

## Root cause

The CLI parsed the effective workflow but discarded that selection when dispatching BYZ-owned workflow commands. The status handler therefore required a positional target that the documented command made optional. It also validated both CM roots before determining that the requested status target was `none`.

## Fix

Pass the already parsed workflow selection into the workflow command handler. For `status`, use an explicit positional target when supplied and otherwise use the effective selection. Handle `none` before CM root validation, reporting it as `active` only when it is the effective selection and as `available` when it is only the query target.

Rejected alternatives:

- Do not add `none` to `workflows.lock.json`; it has no package, files, or runtime resources to lock.
- Do not reparse the stripped CLI arguments; doing so would lose an explicit global `--workflow` selection.
- Do not weaken root-isolation checks for `cm`, `cm-plugin`, `list`, or `check`.

## Impact and regression

Affected surface: BYZ CLI dispatch, workflow status selection, status help text, and smoke tests. Workflow loading, switching, bundled versions, update behavior, and npm publishing are unchanged.

Verified so far with:

- Existing BYZ baseline: 47 tests passed before adding the regression.
- New smoke regression: red with the documented failures, then green with 31 smoke tests passed.
- Complete BYZ package regression: 49 tests passed.
- BYZ release-contract regression: 13 tests passed.
- `npm run check` passed after restoring the ignored generated model-data directory required by a fresh worktree.
- Manual CLI checks returned `cm: available`, `cm-plugin: available`, `none: active`, and `none: available` for their respective selection/query combinations.
- `git diff --check` passed.

Independent review round 1 requested command-specific help text and accurate evidence timing; those corrections are included in attempt 2.
