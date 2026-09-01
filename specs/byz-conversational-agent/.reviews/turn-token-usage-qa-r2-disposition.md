---
at: 2026-09-01T06:32:00-07:00
feature: 3.turn-token-usage
source_review: turn-token-usage-qa-r2.md
disposition: rejected_false_positive
blocking_findings: 0
evidence: /tmp/turn-token-v2-manifest-check.log
---

# QA r2 finding disposition

The manifest finding is rejected as a false positive.

`cm-spec-manifest.py` records semantic hashes, not raw file bytes. It normalizes the explicit AC and task runtime checkboxes so N5/N6 progress cannot invalidate an already approved specification. Raw `sha256sum` output is therefore not comparable to `.cm-specs-status` for `requirements.md` or `tasks.md`.

The authoritative verifier was rerun against the approved status file:

```text
python3 cm-spec-manifest.py specs/byz-conversational-agent \
  --status-file specs/byz-conversational-agent/.cm-specs-status
status: matched
```

All twelve semantic `specFiles`, including the four `3.turn-token-usage` files, matched. No specification or manifest regeneration is required.
