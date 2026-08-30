# Conversation Shell v3 Timing — Built QA

- Result: PASS
- Build: `npm --prefix packages/byz run build`
- Package tests: 120/120 passed
- Repository checks: `npm run check` passed with zero diagnostics
- Terminal: 80x24 tmux, isolated HOME, local faux OpenAI-compatible provider, no real provider/API/token
- Turn duration: faux response streamed over approximately 3.6 seconds

Observed states:

1. At 1 second: `Working · confirming goal · 0m 01s` and `Active 0m 01s · waiting 0m 00s`.
2. During streamed reply: `Working · preparing reply` with increasing active time.
3. Completion: one timing summary with goal and reply stage durations plus active, waiting, and total.
4. All timing lines were readable in the 80-column terminal. The working display updated in place rather than adding progress lines.
5. The fixture used only fixed stage labels. The final timing summary contained no prompt, path, command, tool arguments, or provider payload.
6. tmux, isolated HOME, and local faux provider process were removed after the run.
