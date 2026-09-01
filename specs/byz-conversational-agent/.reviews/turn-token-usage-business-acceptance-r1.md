---
at: 2026-09-01T06:42:00-07:00
role: product-manager
feature: 3.turn-token-usage
verdict: passed
business_deviations: 0
---

# Turn Token Usage — 业务验收走查

## 用户故事闭环

1. 等待长任务时，80 列进度区同时显示阶段耗时与当前回合 observed 输入/输出 Token；未观测时明确显示 `Token —`。
2. 完成摘要分别显示输入、输出、缓存读取、缓存写入；Footer 继续显示 Session 累计，不混淆口径。
3. Provider 缧失 usage 或只有 mandatory all-zero placeholder 时保持不可用；有正值证明 observed 后，同 payload 的合法零字段显示为 `0`。

## AC 走查

- AC-001 至 AC-010：通过。
- all-zero 边界：符合人工批准的 observed-only 失败关闭口径。
- 错误、取消与新回合：用户不会看到上一回合 usage 残留。
- 文案：中英文均区分 unavailable、input/output 与 cache 口径。
- 非交互命令：无新增输出或行为变化。

## 业务偏差

无。

## 结论

`passed`
