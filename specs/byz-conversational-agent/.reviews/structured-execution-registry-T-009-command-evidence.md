# T-009 reproducible command evidence

Every path below is defined by this persisted script; there are no placeholder commands.

```text
HEAD=6a580e78ef09b6862a96cc20a855c46d770ceea5
branch=cm/structured-execution-registry--993b2de7
script_sha256=acb96e894028590ab64f48fb74caba9335b8902061ba3508c2fa2bea142998c1
extension_sha256=fdb48fcfc019f492cbef0f72e2f83d3e123bbcf12c2601d64d7f9c0acf3a6651
working_diff_sha256=e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
```

## Build exact package image

```text
$ npm --prefix packages/byz run build

> @aibyzero/byz@0.1.12 build
> node ./scripts/build.mjs

Built BYZ package image at /Users/zero/Documents/ChatGPT/pi/packages/byz/.byz-output/current.
exit_code=0
```

## Create isolated configuration and exact faux extension

```text
$ mkdir -p '/var/folders/p_/c0gk5fq1551_xk43y28v2frw0000gn/T//byz-feature4-t009-home.Do0MUg/.byz/agent' && printf '%s\n' '{"faux":{"type":"api_key","key":"faux-key"}}' > '/var/folders/p_/c0gk5fq1551_xk43y28v2frw0000gn/T//byz-feature4-t009-home.Do0MUg/.byz/agent/auth.json' && node -e 'const fs=require("node:fs"); fs.writeFileSync(process.argv[1], JSON.stringify({[process.cwd()]:true})+"\n")' '/var/folders/p_/c0gk5fq1551_xk43y28v2frw0000gn/T//byz-feature4-t009-home.Do0MUg/.byz/agent/trust.json' && cp 'specs/byz-conversational-agent/.reviews/structured-execution-registry-T-009-faux-extension.ts.txt' 'packages/byz/.byz-output/t009-faux-extension.ts'
exit_code=0
```

## Built CLI version

```text
$ HOME='/var/folders/p_/c0gk5fq1551_xk43y28v2frw0000gn/T//byz-feature4-t009-home.Do0MUg' BYZ_CODING_AGENT_DIR='/var/folders/p_/c0gk5fq1551_xk43y28v2frw0000gn/T//byz-feature4-t009-home.Do0MUg/.byz/agent' node 'packages/byz/.byz-output/current/dist/cli.js' --version
0.1.12
exit_code=0
```

## Built CLI workflow-isolated version

```text
$ HOME='/var/folders/p_/c0gk5fq1551_xk43y28v2frw0000gn/T//byz-feature4-t009-home.Do0MUg' BYZ_CODING_AGENT_DIR='/var/folders/p_/c0gk5fq1551_xk43y28v2frw0000gn/T//byz-feature4-t009-home.Do0MUg/.byz/agent' node 'packages/byz/.byz-output/current/dist/cli.js' --workflow none --version
0.1.12
exit_code=0
```

## No-plan real 80x24 tmux

```text
$ python3 '/var/folders/p_/c0gk5fq1551_xk43y28v2frw0000gn/T//byz-feature4-t009-tmux.XXXXXX.py' --session 'byz-feature4-t009-no-plan' --mode no-plan --capture 'specs/byz-conversational-agent/.reviews/structured-execution-registry-T-009-tui-no-plan.txt' --home '/var/folders/p_/c0gk5fq1551_xk43y28v2frw0000gn/T//byz-feature4-t009-home.Do0MUg' --agent-dir '/var/folders/p_/c0gk5fq1551_xk43y28v2frw0000gn/T//byz-feature4-t009-home.Do0MUg/.byz/agent' --cli 'packages/byz/.byz-output/current/dist/cli.js' --extension 'packages/byz/.byz-output/t009-faux-extension.ts'
mode=no-plan
max_unicode_columns=80
step_64_lines=0
capture=specs/byz-conversational-agent/.reviews/structured-execution-registry-T-009-tui-no-plan.txt
exit_code=0
```

## No-plan tmux cleanup

```text
$ tmux kill-session -t 'byz-feature4-t009-no-plan' && ! tmux has-session -t 'byz-feature4-t009-no-plan' 2>/dev/null
exit_code=0
```

## 64-task real 80x24 tmux

```text
$ python3 '/var/folders/p_/c0gk5fq1551_xk43y28v2frw0000gn/T//byz-feature4-t009-tmux.XXXXXX.py' --session 'byz-feature4-t009-plan' --mode plan --capture 'specs/byz-conversational-agent/.reviews/structured-execution-registry-T-009-tui-plan.txt' --home '/var/folders/p_/c0gk5fq1551_xk43y28v2frw0000gn/T//byz-feature4-t009-home.Do0MUg' --agent-dir '/var/folders/p_/c0gk5fq1551_xk43y28v2frw0000gn/T//byz-feature4-t009-home.Do0MUg/.byz/agent' --cli 'packages/byz/.byz-output/current/dist/cli.js' --extension 'packages/byz/.byz-output/t009-faux-extension.ts'
mode=plan
max_unicode_columns=80
step_64_lines=1
capture=specs/byz-conversational-agent/.reviews/structured-execution-registry-T-009-tui-plan.txt
exit_code=0
```

## 64-task tmux cleanup

```text
$ tmux kill-session -t 'byz-feature4-t009-plan' && ! tmux has-session -t 'byz-feature4-t009-plan' 2>/dev/null
exit_code=0
```

## Complete BYZ package tests

```text
$ npm --prefix packages/byz test

> @aibyzero/byz@0.1.12 test
> node --test test/*.test.mjs

✔ Pi extension adapter exposes only feature-scoped capability facades (3.819ms)
✔ Execution facade fixes the tool, event, and Session entry boundaries (3.153792ms)
✔ Recovery facade projects the startup session_start reason through a minimal context (0.491625ms)
✔ Recovery facade projects the reload session_start reason through a minimal context (0.093291ms)
✔ Recovery facade projects the new session_start reason through a minimal context (0.07925ms)
✔ Recovery facade projects the resume session_start reason through a minimal context (0.069625ms)
✔ Recovery facade projects the fork session_start reason through a minimal context (0.070041ms)
✔ Recovery facade trust-gates dispatch and each lazy session summary read (0.200083ms)
✔ Recovery facade registers no Pi behavior until a recovery factory uses it (0.144791ms)
✔ all BYZ extension factories mount through their assigned feature ports (1.07175ms)
✔ BYZ composition root injects one feature slice into each extension (5.145125ms)
✔ Pi runtime adapter applies the BYZ product profile at the composition boundary (0.208792ms)
✔ accepts domain and application code that depends only on local ports (13.287417ms)
✔ rejects transparent or legacy Pi adapters (8.243375ms)
✔ rejects public raw Pi escape properties from adapter facades (5.426708ms)
✔ rejects raw Pi injection at the BYZ composition root (4.748292ms)
✔ rejects Pi, adapter, filesystem, and SQLite imports from protected layers (4.943583ms)
✔ rejects a symlink output root before writing or cleaning outside the package (18.736709ms)
✔ rejects a symlink generations root before any generation write (7.732083ms)
✔ rejects portable workflow aliases and ancestor overlap (9.122167ms)
✔ uses one portable namespace for compiled output and reserved runtime paths (0.315333ms)
✔ never takes a lock from the same live process identity (15.436208ms)
✔ recovers only after process absence or PID start-identity reuse (40.475583ms)
✔ fails closed when process identity cannot be determined (11.362292ms)
✔ fails closed when a competing owner becomes unknown after activation (26.0605ms)
✔ ignores an interrupted candidate until complete owner metadata is atomically installed (12.236042ms)
✔ detects output-directory replacement before later lock or publication writes (26.609416ms)
✔ allows exactly one concurrent recovery after the old process is absent (40.876584ms)
✔ fences publication when a stale complete owner becomes unknown (23.903ms)
✔ reports a completed pointer rename when the post-publication fence becomes unknown (27.571917ms)
✔ prevents the dead owner's handle from publishing or releasing after recovery (51.796834ms)
✔ atomically switches one current pointer between complete generations (106.094375ms)
✔ serializes builds with a recoverable process-owned lock (93.667833ms)
✔ production orchestration builds complete generations and preserves current through contention and failure (1168.923667ms)
✔ rejects unsafe manifests and escaped current pointers (3.471667ms)
✔ validates generated roots, package metadata, and runtime assets (3.055625ms)
✔ maps structural conversation states to readable, low-noise output (1.237875ms)
✔ recognizes natural language detail and decision choices (0.396ms)
✔ classifies common request shapes with deterministic local rules (0.444083ms)
✔ parses session preference controls without discarding the user goal (0.312042ms)
✔ routing policy keeps preferences in memory and resets to defaults (0.163ms)
✔ turn timing uses a monotonic clock and separates active stages from confirmation wait (0.332917ms)
✔ compact execution status waits two seconds and uses an observed turn token headline (2.148083ms)
✔ parallel tools stay paired while assistant and malformed tool events interleave (10.113541ms)
✔ BYZ model-active summary excludes tool execution and confirmation waiting (0.68225ms)
✔ turn-local execution state is cleared across agent end and session shutdown (0.860042ms)
✔ stale confirmation continuation cannot resume a newer turn (0.4285ms)
✔ compact status is bilingual, single-line, and hides raw task and tool fields (13.790666ms)
✔ conversation extension refreshes current stage timing and freezes one final summary (6.802958ms)
✔ current turn usage starts unknown and does not inherit session totals (6.729459ms)
✔ streaming usage snapshots and multiple responses are accumulated exactly once (5.4955ms)
✔ partial, invalid, and cumulatively overflowing usage fail closed by field (5.503625ms)
✔ actual AgentSession error and abort paths emit agent_end and clear turn usage (826.009083ms)
✔ confirmation input and fallback time count only as waiting (0.42475ms)
✔ session shutdown clears timing without rendering a completion summary (11.32225ms)
✔ conversation extension shows a scoped progress card after a short wait (5.325875ms)
✔ conversation extension expands progress card in details mode (6.441666ms)
✔ details mode can be saved as the default for future sessions (1.428625ms)
✔ language preference can be saved and reused across sessions (11.809333ms)
✔ conversation extension welcomes without exposing advanced controls until requested (1.250917ms)
✔ conversation status consumes only reliable frozen execution counts (0.5325ms)
✔ registry publication redraws the visible turn without adding a timer (0.210208ms)
✔ 80-column compact status preserves step, timing, and Token while dropping tool noise (0.793042ms)
✔ details mode renders only localized registry facts and a fixed unavailable reason (0.553209ms)
✔ drafting and unavailable execution snapshots do not leak progress or raw fields (0.32275ms)
✔ diagnostic schema accepts only closed low-cardinality projections (2.051542ms)
✔ config is private, normalized, and keeps notice state separate (8.429375ms)
✔ first interactive notice is deferred past other startup notifications and shown once (244.738625ms)
✔ recorder bounds in-flight work and never throws when the worker fails (0.8285ms)
✔ real worker writes a private per-process shard without keeping the process contract (105.734916ms)
✔ diagnostics commands persist state, reject unsafe arguments, and clear by generation (8.844792ms)
✔ generation change stops an active old worker from recreating cleared data (40.811459ms)
✔ retention applies across events, updates, and exports without following symlinks (4.732583ms)
✔ summary tolerates malformed and incomplete rows without exposing their text (143.729792ms)
✔ extension reads only safe event fields (0.913ms)
✔ export contains aggregates only and fails closed on malformed input (18.065166ms)
✔ update health compares only events recorded after a successful update (19.025708ms)
✔ BYZ CLI and complete source-tree build wire diagnostics without replacing workflow extensions (2.527833ms)
✔ health comparison enforces samples, comparability, and correlation-only outcomes (0.1565ms)
✔ registers one closed execution tool and returns only bounded results (1.879292ms)
✔ rejects unknown managed actions and extra fields on every transition (0.612292ms)
✔ binds parallel observed tools to the active task and pairs them once (0.622125ms)
✔ does not let categorized command success or model declarations become verified (0.35975ms)
✔ accepts verified evidence only through a fully bound trusted verifier (0.355334ms)
✔ rejects malformed tool-call identities before pairing or persistence (0.307042ms)
✔ bounds observed receipts and rejects receipt 129 without changing counts (4.98175ms)
✔ stores no raw command, arguments, result, path, or error text in observed receipts (0.281167ms)
✔ replays only projected execution entries on Session start (0.525333ms)
✔ real AgentSession and faux provider execute a 64-task managed plan without network access (444.614291ms)
✔ agent, cancellation, error, compaction, reload, and shutdown persist bounded in-flight closure (1.491708ms)
✔ lifecycle closure preserves the binding when Session append fails and retries once (0.2805ms)
✔ starts empty and exposes ordinal only after an atomic plan is sealed (2.251417ms)
✔ uses a distinct host identity for each explicit plan generation (1.257583ms)
✔ accepts exact task and ID bounds (0.376833ms)
✔ rejects empty, oversized, duplicate, malformed, and mutable sealed task sets (0.270667ms)
✔ sanitizes bounded task labels before Session persistence (0.204083ms)
✔ applies only legal task transitions and keeps duplicate transitions idempotent (0.264333ms)
✔ rejects stale plan and task identities without changing the snapshot (0.201ms)
✔ publishes each accepted state change once and ignores duplicate or rejected transitions (0.170625ms)
✔ does not publish or commit a transition when Session append fails (0.262292ms)
✔ preserves an in-flight binding when observed-receipt append fails (0.388041ms)
✔ replays accepted receipts exactly and treats identical duplicates as idempotent (0.398417ms)
✔ fails a damaged replay generation closed until an explicit new plan (1.15425ms)
✔ does not let a rejected maximum sequence permanently poison explicit recovery (0.243542ms)
✔ does not adopt a rejected hostile generation as the recovery baseline (0.162833ms)
✔ fails unsupported schema, invalid replayed tasks, and illegal replay transitions closed (0.745291ms)
✔ fails cyclic, excessive, non-JSON, and unknown replay payloads closed without throwing (0.932333ms)
✔ fails a replayed 129th evidence receipt closed (1.800291ms)
✔ conflicting duplicates and forged later completion cannot repair replay (0.211125ms)
✔ Conversation, Pause, and Delivery-style consumers share one frozen fact source (0.2515ms)
✔ returns deeply frozen plain snapshots and does not expose mutable internals (0.128792ms)
✔ session_start applies configured Fast defaults and keeps them reversible (1.263708ms)
✔ session_start enables Fast while preserving explicit startup choices (0.234875ms)
✔ Fast without BYZ_FAST_MODEL only lowers thinking and restores it (0.178875ms)
✔ Fast without a selected model still lowers and restores thinking (0.156875ms)
✔ Fast rejects a configured target when no original model can be restored (0.123708ms)
✔ Fast switches to a configured target and restores the original session state (0.184166ms)
✔ Fast restores an adapter-branded model snapshot after extension reload (0.831917ms)
✔ Fast runs through a real AgentSession command without replacing the conversation (58.062916ms)
✔ real AgentSession rejects an unauthenticated configured target without changing state (28.283625ms)
▶ invalid, missing, and unauthenticated targets leave all state unchanged
  ✔ invalid (0.175166ms)
  ✔ missing (0.062292ms)
  ✔ unauthenticated (0.050292ms)
  ✔ same target without auth (0.046292ms)
✔ invalid, missing, and unauthenticated targets leave all state unchanged (0.64625ms)
✔ status and duplicate commands do not repeat transitions (0.513916ms)
✔ failed model restoration keeps Fast active and retains the snapshot for retry (0.10425ms)
✔ explicit model or thinking selections exit Fast without restoring the snapshot (0.247542ms)
✔ busy sessions reject on and off without changing Fast state (0.079833ms)
✔ invalid command arguments report the supported contract (0.0395ms)
✔ importing and constructing readers perform zero spawn (1.010917ms)
✔ returns a validated 12-character lower-case HEAD (0.468042ms)
✔ uses only the fixed executable, argv, cwd, environment, and spawn options (1.484083ms)
▶ maps missing Git and nonzero exit to allowlisted unavailable reasons
  ✔ missing executable (0.439791ms)
  ✔ nonzero exit (0.174542ms)
✔ maps missing Git and nonzero exit to allowlisted unavailable reasons (1.065375ms)
✔ rejects malformed or non-lower-case output without exposing it (0.306083ms)
✔ terminates and degrades when the fixed timeout elapses (1000.539417ms)
▶ terminates on stdout or stderr overflow
  ✔ stdout (0.316542ms)
  ✔ stderr (0.10425ms)
✔ terminates on stdout or stderr overflow (0.700875ms)
✔ the CLI composes Prewalk and the build compiles the complete BYZ source tree (5.016041ms)
▶ actual Prewalk and Fast composition hands the next request off after built-in writes
  ✔ edit (83.47825ms)
  ✔ write (34.102334ms)
✔ actual Prewalk and Fast composition hands the next request off after built-in writes (118.1075ms)
✔ prewalk commands arm, report, and cancel without changing session state (1.460667ms)
▶ prewalk rejects busy, untrusted, Fast-active, and overridden-tool sessions
  ✔ busy (0.102125ms)
  ✔ untrusted (0.0705ms)
  ✔ Fast active (0.286333ms)
  ✔ edit override (0.106667ms)
  ✔ write override (0.067417ms)
✔ prewalk rejects busy, untrusted, Fast-active, and overridden-tool sessions (2.090958ms)
▶ prewalk target validation fails closed without changing model or thinking
  ✔ invalid (0.147458ms)
  ✔ missing (0.067667ms)
  ✔ unauthenticated (0.069584ms)
  ✔ unauthenticated current model (0.048458ms)
✔ prewalk target validation fails closed without changing model or thinking (1.654416ms)
▶ only a successful built-in workspace edit or write consumes prewalk
  ✔ edit (1.986459ms)
  ✔ write (1.775791ms)
✔ only a successful built-in workspace edit or write consumes prewalk (4.186625ms)
✔ prewalk rejects symlink escapes and rechecks built-in tool identity before consuming (5.582209ms)
✔ parallel candidates are serialized and only one valid write consumes prewalk (2.662625ms)
✔ explicit model or thinking changes cancel prewalk and preserve the user selection (0.779125ms)
✔ enabling Fast cancels an armed prewalk without changing Fast behavior (0.439666ms)
✔ session_start returns before CM I/O and allows the welcome notification first (4.762541ms)
✔ five session reasons project safely and reload never duplicates the automatic card (1.718333ms)
✔ manual commands retain the current session reason from session_start context (0.600958ms)
✔ dismiss is session-only, status remains manual, and a new session resets automatic state (0.820917ms)
✔ unknown arguments show fixed usage without echoing or reading evidence (0.227333ms)
✔ untrusted startup and commands perform zero CM, Session, and Git reads (0.6105ms)
✔ trust revocation and newer generations make pending results inert (0.317333ms)
✔ shutdown invalidates an automatic read before its scheduled microtask starts (0.477667ms)
✔ startup, status, and dismiss use zero Git; details uses a second pre-Git trust check and one Git read (1.163041ms)
✔ details rechecks trust immediately before Git and skips Git when revoked (0.294875ms)
✔ compact and details sanitize every rendered field and expose only relative receipts (0.375208ms)
✔ injected renderers receive only bounded sanitized projection data (0.164791ms)
✔ details rejects forged Git and absolute evidence while tolerating decision-only projections (0.219584ms)
✔ manual details renders bounded unavailable diagnostics without Session or Git reads (1.996375ms)
✔ no candidate is silent (0.587875ms)
✔ reader, renderer, Git, callback, and notify failures never escape and warning is once per session (0.447375ms)
✔ untrusted projects perform zero filesystem operations (0.958708ms)
✔ trusted reader returns one bounded project-local snapshot without opening JSONL (15.166125ms)
✔ multiple active project-local candidates are returned only as a decision count (16.222708ms)
✔ running and each unresolved done lifecycle remain actionable while done-resolved is absent (25.833708ms)
✔ known legacy terminal records normalize in memory and remain absent (3.980708ms)
✔ legacy terminal aliases cannot hide multiple unfinished tasks (4.791667ms)
✔ candidate failures are bounded and cannot hide a potentially active record (34.639209ms)
✔ non-direct canonical candidate rejection retains its requested relative path (33.960875ms)
✔ candidate enumeration and pre-existing symlinks fail closed (7.454417ms)
﹣ directory junctions are rejected before candidate reads (0.130875ms) # distinct directory junctions/reparse points cannot be constructed on this platform
✔ matching non-regular review entries retain their project-relative issue path (8.686125ms)
✔ review count, snapshot total and leaf symlink limits fail closed (63.471875ms)
✔ non-regular leaf files are rejected before open (14.533916ms)
✔ project and specs identity replacements independently discard the complete snapshot (19.034584ms)
✔ leaf identity replacement discards the complete snapshot (15.981875ms)
✔ oversized state files are rejected before any file bytes are read (15.886042ms)
✔ terminal sanitizer removes closed and unterminated control channels and bounds code points (0.740416ms)
✔ CM parsers reject lossy nested projections and malformed optional fields (1.221292ms)
✔ review parser accepts only complete canonical authority fields (0.575792ms)
✔ reducer applies decision, conflict, blocked and resumable precedence (0.863041ms)
✔ unknown nested records fail closed without leaking forged display fields (0.105916ms)
✔ free text and unknown workflows cannot grant authority or generate commands (0.127125ms)
✔ reports the BYZ package version (243.50625ms)
✔ uses an isolated BYZ configuration directory (0.131666ms)
✔ uses the BYZ command identity in help (272.864458ms)
✔ applies Fast defaults without removing workflow resources (13.125ms)
✔ defers Fast defaults to the extension only for interactive sessions (0.172542ms)
✔ gives explicit model and thinking options priority over Fast defaults (0.185042ms)
✔ preserves an explicit thinking suffix on the selected model (0.172083ms)
✔ keeps the saved model when Fast resumes an existing session (0.13075ms)
✔ ignores BYZ_FAST_MODEL outside Fast mode (0.081208ms)
✔ preserves --fast after Pi's double-dash argument terminator (0.104625ms)
✔ preserves --fast when Pi consumes it as a mode value (0.061333ms)
✔ rejects duplicate or valued Fast options (0.246792ms)
✔ does not reorder Pi-owned commands in Fast mode (226.299125ms)
✔ ships the documentation paths referenced by the Pi runtime (1.056625ms)
✔ ships runtime assets at the package-root paths expected by Pi (0.527084ms)
✔ does not delegate updates to the Pi release channel (653.231875ms)
✔ does not expose end-user workflow update or rollback commands (425.331458ms)
✔ loads both bundled workflow packages without global installs (436.847208ms)
✔ reports the effective workflow when status has no target (1293.066917ms)
✔ reports an effective none workflow without validating unrelated roots (214.053917ms)
✔ injects only the selected workflow resources (6.974208ms)
✔ supports an explicit no-workflow mode (0.112458ms)
✔ preserves Pi's double-dash argument terminator (5.967292ms)
✔ preserves --workflow when Pi consumes it as a mode value (3.501416ms)
✔ respects Pi resource disable flags (2.362042ms)
✔ does not expose separate installation for bundled workflows (427.969917ms)
✔ locks both bundled workflow sources to full commits (0.518584ms)
✔ checks both workflow roots independently (446.178375ms)
✔ does not fall back to the sibling workflow (215.241292ms)
✔ rejects a shared workflow root (221.384625ms)
✔ rejects nested workflow roots (222.773458ms)
✔ rejects workflow directories without Pi-loadable resources (218.820958ms)
✔ reads only the fixed BYZ npm registry endpoint (1.100334ms)
✔ rejects registry identity substitution and malformed versions (0.357917ms)
✔ plans upgrades without downgrading (0.231917ms)
✔ updates only a writable global BYZ installation (0.420875ms)
✔ diagnostics remain best effort and preserve update rejection identity (0.225083ms)
✔ preserves a custom prefix in non-writable fallback guidance (0.161666ms)
✔ refuses source checkouts and unsupported Pi update options (0.19675ms)
✔ switches workflow resources in place without a model turn (1.138958ms)
✔ switches resources without reloading unrelated extensions or changing the conversation (110.759166ms)
✔ rejects managed themes during startup discovery before applying sibling resources (29.129375ms)
✔ rolls back a real reload when managed discovery returns a theme (62.549ms)
✔ reports current workflow and treats the active target as a no-op (0.177375ms)
✔ rejects a workflow switch while the agent is busy (0.085792ms)
✔ keeps the active workflow when the scoped resource update fails (0.101041ms)
✔ rejects a workflow switch if the agent becomes busy during validation (0.088125ms)
✔ keeps the active workflow when target validation fails (0.098958ms)
✔ rejects unknown workflow command arguments (0.08725ms)
✔ enables workflow switching only for Pi interactive modes (0.334375ms)
✔ uses Pi argument parsing when deciding whether workflow resources are needed (0.065958ms)
✔ BYZ dynamic workflow resources win collisions without hiding unrelated host resources (48.671209ms)
✔ scoped replacement separates owners that share the same display source (44.434875ms)
ℹ tests 255
ℹ suites 0
ℹ pass 254
ℹ fail 0
ℹ cancelled 0
ℹ skipped 1
ℹ todo 0
ℹ duration_ms 6266.650334
exit_code=0
```

## Focused Feature 4 tests

```text
$ node --test packages/byz/test/execution-extension.test.mjs packages/byz/test/execution-registry.test.mjs packages/byz/test/conversation.test.mjs packages/byz/test/architecture.test.mjs
✔ Pi extension adapter exposes only feature-scoped capability facades (3.535083ms)
✔ Execution facade fixes the tool, event, and Session entry boundaries (1.347917ms)
✔ Recovery facade projects the startup session_start reason through a minimal context (0.260416ms)
✔ Recovery facade projects the reload session_start reason through a minimal context (0.077584ms)
✔ Recovery facade projects the new session_start reason through a minimal context (0.074167ms)
✔ Recovery facade projects the resume session_start reason through a minimal context (0.064417ms)
✔ Recovery facade projects the fork session_start reason through a minimal context (0.068708ms)
✔ Recovery facade trust-gates dispatch and each lazy session summary read (0.186917ms)
✔ Recovery facade registers no Pi behavior until a recovery factory uses it (0.219083ms)
✔ all BYZ extension factories mount through their assigned feature ports (0.97375ms)
✔ BYZ composition root injects one feature slice into each extension (3.470708ms)
✔ Pi runtime adapter applies the BYZ product profile at the composition boundary (0.191875ms)
✔ accepts domain and application code that depends only on local ports (8.66875ms)
✔ rejects transparent or legacy Pi adapters (3.895833ms)
✔ rejects public raw Pi escape properties from adapter facades (3.113333ms)
✔ rejects raw Pi injection at the BYZ composition root (2.765625ms)
✔ rejects Pi, adapter, filesystem, and SQLite imports from protected layers (2.558958ms)
✔ maps structural conversation states to readable, low-noise output (1.44825ms)
✔ recognizes natural language detail and decision choices (0.450583ms)
✔ classifies common request shapes with deterministic local rules (0.456291ms)
✔ parses session preference controls without discarding the user goal (0.323ms)
✔ routing policy keeps preferences in memory and resets to defaults (0.165292ms)
✔ turn timing uses a monotonic clock and separates active stages from confirmation wait (0.343292ms)
✔ compact execution status waits two seconds and uses an observed turn token headline (2.30975ms)
✔ parallel tools stay paired while assistant and malformed tool events interleave (6.261958ms)
✔ BYZ model-active summary excludes tool execution and confirmation waiting (0.523167ms)
✔ turn-local execution state is cleared across agent end and session shutdown (0.682208ms)
✔ stale confirmation continuation cannot resume a newer turn (0.291542ms)
✔ compact status is bilingual, single-line, and hides raw task and tool fields (13.2025ms)
✔ conversation extension refreshes current stage timing and freezes one final summary (5.72225ms)
✔ current turn usage starts unknown and does not inherit session totals (6.485584ms)
✔ streaming usage snapshots and multiple responses are accumulated exactly once (6.349083ms)
✔ partial, invalid, and cumulatively overflowing usage fail closed by field (6.75025ms)
✔ actual AgentSession error and abort paths emit agent_end and clear turn usage (880.032375ms)
✔ confirmation input and fallback time count only as waiting (0.529459ms)
✔ session shutdown clears timing without rendering a completion summary (12.459583ms)
✔ conversation extension shows a scoped progress card after a short wait (7.8135ms)
✔ conversation extension expands progress card in details mode (7.758917ms)
✔ details mode can be saved as the default for future sessions (7.39975ms)
✔ language preference can be saved and reused across sessions (8.022125ms)
✔ conversation extension welcomes without exposing advanced controls until requested (2.299375ms)
✔ conversation status consumes only reliable frozen execution counts (0.7525ms)
✔ registry publication redraws the visible turn without adding a timer (0.336875ms)
✔ 80-column compact status preserves step, timing, and Token while dropping tool noise (2.592625ms)
✔ details mode renders only localized registry facts and a fixed unavailable reason (1.622583ms)
✔ drafting and unavailable execution snapshots do not leak progress or raw fields (0.8135ms)
✔ registers one closed execution tool and returns only bounded results (1.767084ms)
✔ rejects unknown managed actions and extra fields on every transition (0.597041ms)
✔ binds parallel observed tools to the active task and pairs them once (0.531792ms)
✔ does not let categorized command success or model declarations become verified (0.320917ms)
✔ accepts verified evidence only through a fully bound trusted verifier (0.34725ms)
✔ rejects malformed tool-call identities before pairing or persistence (0.26425ms)
✔ bounds observed receipts and rejects receipt 129 without changing counts (4.275625ms)
✔ stores no raw command, arguments, result, path, or error text in observed receipts (0.304209ms)
✔ replays only projected execution entries on Session start (0.470291ms)
✔ real AgentSession and faux provider execute a 64-task managed plan without network access (405.67825ms)
✔ agent, cancellation, error, compaction, reload, and shutdown persist bounded in-flight closure (1.867166ms)
✔ lifecycle closure preserves the binding when Session append fails and retries once (0.367958ms)
✔ starts empty and exposes ordinal only after an atomic plan is sealed (1.847125ms)
✔ uses a distinct host identity for each explicit plan generation (1.146208ms)
✔ accepts exact task and ID bounds (0.375167ms)
✔ rejects empty, oversized, duplicate, malformed, and mutable sealed task sets (0.280125ms)
✔ sanitizes bounded task labels before Session persistence (0.223333ms)
✔ applies only legal task transitions and keeps duplicate transitions idempotent (0.22625ms)
✔ rejects stale plan and task identities without changing the snapshot (0.159625ms)
✔ publishes each accepted state change once and ignores duplicate or rejected transitions (0.163542ms)
✔ does not publish or commit a transition when Session append fails (0.286625ms)
✔ preserves an in-flight binding when observed-receipt append fails (0.405792ms)
✔ replays accepted receipts exactly and treats identical duplicates as idempotent (0.411708ms)
✔ fails a damaged replay generation closed until an explicit new plan (0.286291ms)
✔ does not let a rejected maximum sequence permanently poison explicit recovery (0.160667ms)
✔ does not adopt a rejected hostile generation as the recovery baseline (0.162917ms)
✔ fails unsupported schema, invalid replayed tasks, and illegal replay transitions closed (1.041958ms)
✔ fails cyclic, excessive, non-JSON, and unknown replay payloads closed without throwing (0.431375ms)
✔ fails a replayed 129th evidence receipt closed (1.5155ms)
✔ conflicting duplicates and forged later completion cannot repair replay (0.205083ms)
✔ Conversation, Pause, and Delivery-style consumers share one frozen fact source (0.253459ms)
✔ returns deeply frozen plain snapshots and does not expose mutable internals (0.122459ms)
ℹ tests 78
ℹ suites 0
ℹ pass 78
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 1198.444083
exit_code=0
```

## Repository checks

```text
$ npm run check
npm warn Unknown project config "min-release-age". This will stop working in the next major version of npm.

> pi-monorepo@0.0.3 check
> biome check --write --error-on-warnings . && npm run check:pinned-deps && npm run check:ts-imports && npm run check:shrinkwrap && npm run check:install-lock:coding-agent && npm --prefix packages/byz run check:architecture && tsgo --noEmit && npm run check:browser-smoke

Checked 1161 files in 1973ms. No fixes applied.
npm warn Unknown env config "min-release-age". This will stop working in the next major version of npm.
npm warn Unknown project config "min-release-age". This will stop working in the next major version of npm.

> pi-monorepo@0.0.3 check:pinned-deps
> node scripts/check-pinned-deps.mjs

npm warn Unknown env config "min-release-age". This will stop working in the next major version of npm.
npm warn Unknown project config "min-release-age". This will stop working in the next major version of npm.

> pi-monorepo@0.0.3 check:ts-imports
> node scripts/check-ts-relative-imports.mjs

npm warn Unknown env config "min-release-age". This will stop working in the next major version of npm.
npm warn Unknown project config "min-release-age". This will stop working in the next major version of npm.

> pi-monorepo@0.0.3 check:shrinkwrap
> node scripts/generate-coding-agent-shrinkwrap.mjs --check

packages/coding-agent/npm-shrinkwrap.json is up to date.
npm warn Unknown env config "min-release-age". This will stop working in the next major version of npm.
npm warn Unknown project config "min-release-age". This will stop working in the next major version of npm.

> pi-monorepo@0.0.3 check:install-lock:coding-agent
> node scripts/generate-coding-agent-install-lock.mjs --check

packages/coding-agent/install-lock is up to date.
npm warn Unknown env config "min-release-age". This will stop working in the next major version of npm.

> @aibyzero/byz@0.1.12 check:architecture
> node ./scripts/check-architecture.mjs

BYZ architecture dependency check passed.
npm warn Unknown env config "min-release-age". This will stop working in the next major version of npm.
npm warn Unknown project config "min-release-age". This will stop working in the next major version of npm.

> pi-monorepo@0.0.3 check:browser-smoke
> node scripts/check-browser-smoke.mjs

exit_code=0
```

## Diff whitespace check

```text
$ git diff --check
exit_code=0
```

## Isolated resource cleanup

```text
$ rm -rf '/var/folders/p_/c0gk5fq1551_xk43y28v2frw0000gn/T//byz-feature4-t009-home.Do0MUg' '/var/folders/p_/c0gk5fq1551_xk43y28v2frw0000gn/T//byz-feature4-t009-tmux.XXXXXX.py' 'packages/byz/.byz-output/t009-faux-extension.ts' && test ! -e '/var/folders/p_/c0gk5fq1551_xk43y28v2frw0000gn/T//byz-feature4-t009-home.Do0MUg' && test ! -e '/var/folders/p_/c0gk5fq1551_xk43y28v2frw0000gn/T//byz-feature4-t009-tmux.XXXXXX.py' && test ! -e 'packages/byz/.byz-output/t009-faux-extension.ts'
exit_code=0
```
