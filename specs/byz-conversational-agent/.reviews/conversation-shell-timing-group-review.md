# Conversation Shell v3 Timing — Independent Review

- Channel: fresh ephemeral read-only `codex-cli`
- Scope: `turn-timing.js`, timing changes in `conversation-extension.js`, and timing tests.
- Round 1: timed out before final verdict but produced one concrete finding: assistant streaming `message_update` events could redraw the working message at token frequency. It also raised 80-column timing-line readability risk.
- Disposition: reply rendering now occurs only on the first stage transition; 20 repeated updates produce no additional render. Timing output uses short fixed localized labels and two short lines. A shutdown lifecycle regression was added.
- Round 2: zero findings.
- Verdict: approved.
- Targeted tests at review: 14/14 passed.
