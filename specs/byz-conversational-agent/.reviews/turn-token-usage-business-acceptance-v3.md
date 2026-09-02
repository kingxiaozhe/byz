# Turn Token Usage v3 — 业务验收走查

## 结论

通过。用户可以在长任务中看到低噪声、事实口径明确的状态、耗时、当前回合 Token 和运行工具数量；短任务不闪烁，完成摘要不混入 Session Footer 口径。

## 用户流程

1. 用户提交任务：2 秒内完成时不出现自定义状态；超过 2 秒显示单行 BYZ 状态、总耗时和 `Token —`。
2. Provider usage 到达：headline 只显示本轮 observed `input + output`，cache 不混入。
3. 工具执行：显示安全状态和当前运行工具数；并行、乱序、重复、未知 ID 不产生虚假数量。
4. 需要人工确认：显示等待状态，等待时间不计入 BYZ 模型活跃时间。
5. 任务结束：固定两行显示总耗时、Token、BYZ 模型活跃时间、非零工具/失败/等待信息。
6. 用户显式开启详情：继续看到既有经清理目标、活动、边界和 usage 分项；Footer 仍为 Session 累计。

## AC 对照

- AC-001 至 AC-016：通过。技术与 TUI 证据见 `turn-token-usage-T-006-qa.md`。
- 80 列真实终端状态、完成摘要和非交互命令证据见 `turn-token-usage-T-006-tui-evidence.md`。

## 文案与边界

- “BYZ 思考”明确表示客户端观察到的模型活跃区间，不宣称 hidden chain-of-thought。
- 默认紧凑输出不显示 Tasks、百分比、toolName、命令、参数、路径、tool result、Prompt 或响应正文。
- Token 未知保持 `—`，不估算、不以零冒充事实。

## 业务偏差

无。
