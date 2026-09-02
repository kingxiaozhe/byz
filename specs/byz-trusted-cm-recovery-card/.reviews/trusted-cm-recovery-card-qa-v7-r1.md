# Trusted CM Recovery Card v7 QA Report

- Mode: feature-level commands + logic
- Result: **PASSED**
- Focused recovery tests: **37 passed, 0 failed, 1 explicit platform skip**
- BYZ package suite: **210 passed, 0 failed, 1 explicit platform skip**
- Repository check: **passed**
- Coverage: **not collected** (the approved Node test commands do not enable a coverage reporter)

## AI test contract

| Case | Result | Evidence |
| --- | --- | --- |
| TC-001 | PASS | Existing adapter/extension lifecycle tests plus BYZ suite |
| TC-002 | PASS | Untrusted zero-I/O reader and extension tests |
| TC-003 | PASS | Done/actionable candidate matrix and direct-candidate bounds |
| TC-004 | PASS | Symlink, non-file, identity, size and explicit platform-skip tests |
| TC-005 | PASS | Strict parser/reducer focused tests and T-011 review chain |
| TC-006 | PASS | Git reader and details-only Git package tests |
| TC-007 | PASS | Terminal sanitizer and malicious render-input tests |
| TC-008 | PASS | Project command trust, dismiss and argument tests |
| TC-009 | PASS | Failure-isolation tests plus Conversation/Fast/Prewalk/workflow package regression |
| TC-010 | PASS | T-008/T-009 historical packed boundary evidence; no package metadata, dependency or pipeline change; not represented as a current byte receipt |
| TC-011 | PASS | Closed legacy parser matrix and source-byte no-write regression |
| TC-012 | PASS | Bounded issue aggregation, terminal-alias reconciliation and exact source-path regressions |
| TC-013 | PASS | Startup/status fixed warning and sanitized unavailable details with zero Session/Git reads |

All 13 blocking logic cases pass. The only skip is the approved Windows-only junction/reparse construction on macOS; equivalent symlink, non-regular-file and identity boundaries pass.

## Acceptance criteria

AC-001 through AC-025 are supported by the case matrix and content-bound task reviews. T-013's blocked reviews are historical only; current reader approval is T-016 attempt 2. T-014 approval binds the exact formatter-normalized details bytes.

## Security and scope

- No dependency or lockfile changes.
- No recovery source imports or calls project-state write APIs.
- No hooks, watchers or daemons.
- Unavailable diagnostics accept only allowlisted reason codes and safe relative paths, capped at eight.
- No raw exception, field value, absolute path, Session body or extra Git read reaches the unavailable card.

## Conclusion

**PASSED**. No QA fix round is required.
