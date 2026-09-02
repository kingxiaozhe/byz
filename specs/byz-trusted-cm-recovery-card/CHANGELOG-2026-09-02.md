# 变更日志 — 2026-09-02

> base-commit: d3247c7491723a67bb309d62b9627d453a3cbb87

## Feature 1: trusted-cm-recovery-card v7

### 新增

- `/project details` 在恢复不可用时显示固定标题、allowlist reason code 和最多八条安全项目相对来源路径。

### 修复

- 只读兼容 manifest `schema_version: 1`、status `task: null`、status `state: completed` 三种旧形态。
- Candidate scanner 继续有界扫描并归集问题；损坏或仍有未完成任务的候选不能被有效候选或 terminal alias 隐藏。
- Candidate、review 和 direct-child 边界拒绝均保留安全相对来源路径。

### 关键文件

- `packages/byz/src/recovery/recovery-state.js` — 封闭旧状态规范化。
- `packages/byz/src/recovery/cm-evidence-reader.js` — 候选问题归集、终态判断与来源路径绑定。
- `packages/byz/src/recovery/recovery-extension.js` — unavailable details 脱敏诊断卡。
- `packages/byz/test/recovery-*.test.mjs` — 兼容、边界、失败关闭与 UI 回归。

### 架构决策

- 兼容只在内存 parser 边界发生，不写回 CM 状态，不接受未知版本或状态。
- `task: null` 不等于全部任务完成；canonical tasks 仍有未完成项时保持 actionable。
- 自动启动保持低噪声固定 warning，详细诊断只由用户显式请求。

### 验证

- Focused recovery tests: 37 passed, 1 explicit platform skip, 0 failed.
- BYZ package suite: 210 passed, 1 explicit platform skip, 0 failed.
- `npm run check`: passed.
- Feature-level QA and business acceptance: passed.
