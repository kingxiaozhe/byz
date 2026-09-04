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

## BYZ conversation timing

**线路**：Agent lifecycle signals → turn-local selector (`waiting > in-flight tools > recover > reply/think`) → monotonic timing/usage/tool snapshot → delayed single-line working status → two-line completion summary.

**关键规则**：

- Compact status starts only after two seconds and refreshes at most once per second. Short turns do not flash custom status; without a sealed execution-registry plan, no Tasks, total, ordinal, or percentage is invented.
- Tool starts/ends pair only by stable `toolCallId`; duplicate, unknown, missing, parallel, and out-of-order events cannot produce negative or repeated counts. Assistant updates cannot overwrite an active tool or prematurely clear a parallel failure.
- The headline is safe observed current-turn `input + output`; cache remains a details-only breakdown and Footer usage remains Session-cumulative. Unknown, all-zero placeholders, invalid fields, and overflow fail closed.
- Client-observed model-active time sums only `think`, `recover`, and `reply`; tool stages and confirmation waiting are excluded. It is not hidden chain-of-thought.
- Timeout, interval, and asynchronous confirmation continuations capture a turn generation before reading shared state, so callbacks from an ended turn cannot reveal, redraw, or resume a newer turn.
- Default compact rendering never consumes Prompt/response text, tool names, arguments, paths, results, or commands. Explicit details retain the existing cleaned activity card and usage breakdown.
- The Footer reads the effective Thinking level at session start and consumes `thinking_level_select` only as a notification, preserving model/Fast ownership of the real setting.

## BYZ structured execution registry

**线路**：managed `byz_execution` call → closed action/schema validation → pure registry proposal → existing Session custom-entry append → in-memory commit/publication → frozen Conversation/Pause/Delivery consumer snapshot.

**关键规则**：

- `plan_open` atomically accepts 1–64 unique bounded task IDs; only explicit `plan_seal` makes total and ordinal displayable. Task states follow the closed pending/active/completed|blocked|cancelled reducer.
- Session append is the transition linearization point. Append failure leaves snapshot, subscriber state, sequence, and in-flight binding unchanged; accepted receipts replay only within the same Session.
- Replay validates schema, safe sequence/generation, identities, limits and legal transitions. Hostile or damaged generations become unavailable and cannot be repaired by later completion claims; an explicit new generation resumes from the last accepted baseline.
- Tool observations bind stable `toolCallId` to the active task at start and pair once at end. Parallel, out-of-order, duplicate, unknown and lifecycle-closed observations stay bounded and never persist raw arguments, commands, paths, results or free-form errors.
- Provenance remains `declared`, categorized `observed`, or fully bound `verified`. Natural language and successful command classification cannot grant verified status.
- Lifecycle end, cancellation, errors, compaction, reload and shutdown persist bounded failure closure receipts for in-flight work without completing tasks. Session append failure keeps the binding retryable.
- Consumers receive deeply frozen plain data only. The registry does not create project/global state, parse model prose, or authorize tools. Verified receipts may carry a closed test/check/build/review/QA category for downstream readiness gates.

## BYZ safe pause and resume

**线路**：`/pause` request → generation-bound model/tool admission gate → already admitted parallel tool drain → paused confirmation state → `/pause resume` or `/pause abort` → bounded Session receipt and independent pause timing.

**关键规则**：

- A pause occurs only before a model request or tool batch admission; it never interrupts an already admitted side effect.
- Parallel tools drain as one batch, including more than 128 calls, before one shared paused gate; stale generations cannot resume newer work.
- Delivery/other confirmation dialogs remain modal and cannot create a nested pause lease. Pi Session `/resume` is not replaced.
- Compact UI reports only closed pause state and bounded registry identity; pause wait is excluded from model/tool/confirmation time.

## BYZ delivery console

**线路**：successful edit/write start/end pair → post-mutation digest Session receipt → explicit `/deliver` Git snapshot → category-aware readiness → one-time action confirmation → state revalidation → fixed argv Git/gh action → observed result receipt.

**关键规则**：

- Startup and ordinary turns run zero Git. Delivery is trusted-project-only and explicit status/release remain read-only.
- Commit scope is the intersection of current-plan observed paths, matching post-mutation digests and current unstaged tracked changes. Unobserved, changed-again, staged, untracked, conflicted and symlink-escaped paths never enter the commit.
- Commit/push/draft-PR/merge each use a separate five-minute intent bound to the full local/remote/PR fingerprint. Commit rechecks exact staged paths and blobs; push is origin/current-branch only.
- GitHub actions carry the sanitized origin repository. Merge requires exact PR repository/head/base, mergeability, and every protected check context with its required GitHub App identity.
- Git/gh capability calls use a closed argv allowlist and reject force/admin/no-verify forms. Receipts omit commands, outputs, diffs, bodies, credentials and absolute paths.
- `/deliver release` only reports pending readiness. The console is a workflow gate, not an OS permission sandbox.

## BYZ local diagnostics

**线路**：BYZ CLI/runtime hooks → strict event projection (`diagnostics/schema.js`) → bounded recorder → unrefed Worker → private per-process JSONL shards → local summary/export/update-health commands.

**关键规则**：

- Diagnostics are local-only and aggregate-only on export; prompts, responses, code, paths, credentials, tool arguments/output, and free-form errors never enter the event schema.
- Logging is best effort: bounded queues, disk/permission failures, invalid events, and Worker failures may drop records but must not alter BYZ output, exit status, or update error identity.
- Clear uses a generation change so stale Workers cannot recreate cleared data. Retention covers events, state, summaries, update snapshots, and managed exports without following symlinks.
- Update comparisons require matching runtime identity and event/mode/tool/provider series with at least 20 samples on both sides. Results are correlation-only and never trigger rollback or upload.
- Interactive privacy notice state is separate from enablement. Worker listeners must be installed before the final `unref()` so idle diagnostics cannot keep commands alive.

## BYZ trusted project recovery

**线路**：trusted interactive Session → bounded project-local CM candidate scan → strict legacy-aware projection → recovery reducer → compact warning/card or explicit `/project details` diagnostics.

**关键规则**：

- Legacy compatibility is closed to manifest `schema_version: 1`, status `task: null`, and status `state: completed`; normalization is memory-only.
- Every unresolved or malformed candidate remains fail-closed. Candidate problems are bounded to eight stable reason/project-relative-path receipts and cannot be hidden by another valid candidate.
- Startup and `/project status` expose only one fixed warning per Session. Unavailable `/project details` filters unsafe issue fields and performs no Git or Session-body read.

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
