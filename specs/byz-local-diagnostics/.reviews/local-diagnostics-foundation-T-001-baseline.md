# T-001 防护网基线

- 日期: 2026-08-30
- Git 基线: `1377a1135dae82b57ff569935898c1523d9a680f` (`main`)
- 工作树基线: 开工前只有本轮新增的 `prd/prd-byz-local-diagnostics.md` 与 `specs/byz-local-diagnostics/`
- 正式命令: `npm --prefix packages/byz test`
- 结果: 101/101 通过，0 失败，总耗时约 5.38 秒
- 测试对象: `packages/byz/src/cli.js` 与被测试的 `packages/byz/dist/cli.js` SHA-256 均为 `d545fd0eac578aa9fab99fd848432476219580a19776d2b044dd95ad4e659286`
- 构建边界: 按项目规则未运行 build；本基线通过 source/dist 内容哈希绑定当前 CLI 产物，后续新增模块测试直接引用 `src/`
- 覆盖的现有行为: conversation、Fast、Prewalk、CLI smoke、workflow、update
- 普通参数转发: `node packages/byz/dist/cli.js auth --help` 返回 0，并显示 Pi auth 帮助
- 启动测量命令: 隔离 HOME 和 `BYZ_DIAGNOSTICS_HOME` 后运行 `node packages/byz/dist/cli.js --version`
- 诊断状态: 隔离 config 明确写入 `enabled: false`
- 环境: Node `v24.14.0`; 5 次预热后记录 30 次；p95 使用 nearest-rank (`ceil(n*0.95)`)
- 中位数: 194.32 ms
- p95: 201.88 ms
- 原始样本(ms): 192.764, 197.221, 193.721, 192.381, 202.045, 194.800, 193.907, 192.367, 201.884, 197.089, 196.504, 200.874, 192.552, 201.166, 198.458, 193.803, 192.800, 194.207, 195.660, 193.478, 194.305, 194.129, 193.675, 198.650, 195.921, 201.449, 193.159, 194.322, 197.150, 196.896
- 用途: T-009 复用相同隔离、预热、样本量和算法比较；允许日志丢失，不允许业务命令结果或退出码变化。
