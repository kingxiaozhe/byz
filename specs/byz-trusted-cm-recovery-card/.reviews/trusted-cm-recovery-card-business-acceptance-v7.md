# Trusted CM Recovery Card v7 Business Acceptance

## User flow

1. A trusted interactive session starts normally and remains usable when recovery evidence is unavailable.
2. Startup and `/project status` expose only the fixed warning once per session.
3. The user explicitly runs `/project details` to obtain a fixed unavailable title, stable reason code and at most eight safe project-relative issue paths.
4. Known terminal legacy records disappear only when no unfinished canonical work remains; ambiguous or damaged work stays closed and cannot be resumed silently.

## Product acceptance

- Real warning root cause addressed without adding `/context`, permissions, hooks, agents or new storage.
- Automatic output remains low-noise; detailed diagnostics remain user-initiated.
- Diagnostic output does not expose raw errors, field values, absolute paths, Session text or extra Git context.
- Unknown legacy formats remain rejected; compatibility is limited to the three approved forms.
- Existing Conversation, Fast, Prewalk and workflow behavior passed package regression.

## Deviations

No requirement-intent deviation found. T-013's blocked implementation history was replaced by independently approved T-016 and is not counted as delivery approval.

## Conclusion

**PASSED** from the user-visible workflow and acceptance-criteria perspective.
