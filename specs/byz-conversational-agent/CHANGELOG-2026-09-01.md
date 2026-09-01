# 变更日志 — 2026-09-01

> base-commit: bf20830461ed4e99ba921b7da6293b6f58e47f23

## Feature 1: Conversation Shell

本轮无独立变更；当前回合 Token usage 复用其阶段计时、working message 与完成摘要。

## Feature 2: Routing Preferences

本轮无变更。

## Feature 3: Turn Token Usage

### 新增

- 进度区展示当前回合已观测的输入与输出 Token，完成摘要补充缓存读取与缓存写入。
- 未观测 usage 显示 `Token —`；mandatory standalone all-zero placeholder 保持不可用，mixed observed payload 的合法零字段显示为 `0`。
- Footer 继续展示 Session 累计 usage，不改变 Thinking 与窄终端优先级。

### 关键文件

- `packages/byz/src/adapters/pi/pi-runtime-adapter.ts` — closed-schema usage 投影、presence gate 与安全整数聚合。
- `packages/byz/src/conversation/conversation-extension.js` — turn-scoped snapshot、commit、aggregate override、进度与完成文案。
- `packages/byz/test/conversation.test.mjs` — streaming、多响应、非法值、真实取消/错误清理与副作用回归。
- `packages/byz/test/architecture.test.mjs` — Adapter all-zero、mixed zero 与 capability 边界。
- `scripts/byz-packed-runtime.test.mjs` — 80 列 packed TUI 与 current-screen 回归。

### 架构决策

- 只显示 Provider/Pi 已返回且可证明 observed 的 usage，不做 tokenizer 或费用估算。
- snapshot update 替换当前响应，`message_end` 恰好提交一次，`agent_end` 聚合值权威收口。
- mandatory all-zero 没有独立 presence 信号时失败关闭为 unavailable；正值建立 presence 后保留显式零 sibling。
- usage 状态只存在于当前 turn，不新增网络、模型调用、存储、诊断或 timer。

### 验证

- Fresh v2 focused Adapter/Conversation — 34/34 通过。
- BYZ package — 204 通过，1 项平台 skip。
- Packed runtime — 2/2 通过。
- `npm run check`、`./test.sh` — 通过。
- 独立 N6 QA — AC 10/10、TC 5/5 通过。
