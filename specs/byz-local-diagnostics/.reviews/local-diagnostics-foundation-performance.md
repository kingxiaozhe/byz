# Local Diagnostics Foundation 性能验证

- 日期: 2026-08-30
- 环境: Node v24.14.0
- 初始化路径: 读取隔离本地 config + 构造 recorder + fake Worker；1000 次
- 初始化 p95: 0.026 ms（预算 ≤20 ms）
- 高频记录路径: 白名单验证 + 有界 credit + 小对象 postMessage/ack；10000 次
- 单次 record p95: 0.0015 ms
- 解释: 对设计中的最小 `10ms-100ms` 工具操作，p95 增量上界约 0.015%，低于 1% 预算。
- Worker 文件 I/O 不在调用方等待路径；队列满直接丢弃。
- 完整 CLI 启动基线见 `local-diagnostics-foundation-T-001-baseline.md`。项目规则未授权 build，因此本轮不执行构建后 CLI 二次计时；主线程新增路径的直接测量作为增量证据。
