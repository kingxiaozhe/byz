## 待触发备忘

无。

## 2026-08-31 — Trusted CM Recovery Card / 基线防护网

- [已结构化] 基线报告必须保留可直接复跑的完整命令，而不是测试数量摘要；本任务已把完整命令和首次瞬时失败的定向/全量复跑写入内容绑定凭证。
- [已结构化] 跨任务测试合同只在当前任务责任范围内判定；TC-010 的 T-001 结论仅证明 pre-feature baseline，post-feature 行为仍由 T-005/T-007 验证。

## 2026-08-31 — Trusted CM Recovery Card / 交付复盘

- [已结构化] CM task/review Markdown 采用 canonical line protocol 比追求完整 YAML 等价解析更小、更可审计；所有形似 authority/task 但非 canonical 的输入直接失败关闭。
- [已结构化] “只读 review header”必须同时限制物理读取和 receipt 哈希范围；完整文件大小先验上限不能替代 header-only source minimization。
- [已结构化] 并行任务必须使用独立 worktree 与不相交写集；本次三 worker 加协调器的四核批次通过机械 parallel-write gate，汇合后统一执行 `npm run check`。
- [已结构化] packed test 默认只打包 current immutable generation；验证新源码前必须先生成当前 package image，否则会得到可验证但过期的 tarball。
- [已结构化] packed 模块调用不能替代真实 CLI composition 启动。最终矩阵必须从仓库外、隔离 HOME 的 installed `byz` 入口观察恢复卡，并核对项目 fixture 启动前后字节不变。
- [已结构化] T-009 只有在 package artifact 输入未变化时才能复用 T-008 receipt；CM review、task checkbox 与运行日志不是 package artifact 输入。

## 2026-09-01 — Recovery startup notification fix

- [已结构化] `info` 的单行状态可相邻替换，多行信息卡必须持久；否则延迟到达的普通状态会无声覆盖用户需要继续操作的恢复证据。
- [已结构化] 累积 PTY 字节只能证明内容曾经出现，不能证明两个组件仍在当前屏幕同时可见；终端覆盖类缺陷必须使用 current-screen oracle。
- [已结构化] BYZ package image 复制 `packages/coding-agent/dist`；修改 coding-agent 源码后必须先重建该 runtime，再生成 BYZ image，否则 packed 验证会测试旧实现。
- [已结构化] PTY Buffer 必须以 raw `Uint8Array` 进入流式终端解码器；逐 chunk `toString()` 会在多字节 UTF-8 边界产生 replacement character，使正确的 current-screen oracle 假失败。
