# TC-007 real TUI evidence

- Terminal: tmux `80×24`
- Runtime: built BYZ package image at the working-tree `packages/byz/.byz-output/current` pointer
- Provider: local faux provider loaded by a temporary extension; no external endpoint
- Managed flow: `plan_open` with 64 tasks → `plan_seal` using the returned host plan ID → `task_start` for `task-64` → slow local final response

Command transcript:

```text
tmux new-session -d -s byz-feature4-real-tui -x 80 -y 24
HOME=<isolated> node packages/byz/.byz-output/current/dist/cli.js --workflow none -e <temporary-faux-extension>
select: Trust (this session only)
input: execute the structured plan
poll capture-pane until: Step 64/64
capture-pane -> structured-execution-registry-T-005-tui-capture.txt
```

Assertions:

```text
exactly one captured line contains Step 64/64
all captured lines contain at most 80 Unicode code points
Step line contains elapsed time and Tokens
exit/assertion status: 0
```

The tmux session, isolated HOME, temporary provider extension and temporary assertion script were removed after capture.
