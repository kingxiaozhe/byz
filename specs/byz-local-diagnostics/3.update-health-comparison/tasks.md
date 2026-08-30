# Update Health Comparison — 任务清单

## 任务版本

| 日期 | 版本 | 说明 |
| --- | --- | --- |
| 2026-08-30 | v1 | 初始任务 |

## 项目信息

- 项目名: pi-monorepo
- 架构类型: Node.js npm workspace monorepo
- specs 路径: `specs/byz-local-diagnostics/3.update-health-comparison/`

## 任务列表

### 防护网基线

- [x] T-001: 运行并记录现有 `packages/byz/test/update.test.mjs` 与 diagnostics summary/clear 测试，锁定更新参数、包身份、不降级、registry 和退出码行为 ~20min

### 更新诊断

- [x] T-002: 为 `handleByzUpdate` 增加默认 no-op diagnostics facade，在更新计划、成功和失败路径做不等待投递；失败后原样 rethrow，并覆盖 facade 抛错/禁用/队列满测试 ~1h
- [x] T-003: 在 diagnostics Worker 实现更新前聚合基线、更新结果和 pending 状态；缺失基线固定判为 insufficient_data，不等待 ack、不保持进程存活 ~1.5h
- [x] T-004: 实现同类环境比较、20/20 样本门槛、5个百分点/耗时桶趋势规则、环境不可比和 correlation-only DTO 测试 ~1.5h
- [x] T-005: 将最近 comparison 接入 `diagnostics summary` 和 generation retention/clear，覆盖禁用、过期、Schema 不兼容和删除行为 ~1h

### 回归与文档

- [x] T-006: 复跑 T-001 和 foundation 非干扰测试，验证基线目录只读、磁盘满、Worker 失败时 update 命令对象、输出、退出码和 rejection identity 不变 ~1h
- [x] T-007: 更新 BYZ README/CHANGELOG，说明样本门槛、环境不可比、相关性声明和绝不自动回滚/上传 ~20min

## 依赖关系

- 本 feature 依赖 `1.local-diagnostics-foundation` 完成。
- T-002、T-003 依赖 T-001。
- T-004 依赖 T-003。
- T-005 依赖 T-004。
- T-006 依赖 T-002、T-005。
- T-007 依赖 T-006。

## AC 映射

| 任务 | AC |
| --- | --- |
| T-002 | AC-001, AC-002, AC-011 |
| T-003 | AC-002, AC-007, AC-008 |
| T-004 | AC-003, AC-004, AC-005, AC-006 |
| T-005 | AC-008, AC-009, AC-010 |
| T-006 | AC-001, AC-007, AC-008, AC-010, AC-011 |

## 风险点

- 基线投递不得被 await；因此允许缺失，只能显示数据不足，不能为完整率反推数据。
- 更新失败必须 rethrow 同一个 rejection value，不得包装错误。
- 比较结果只能描述趋势，不能触发自动回滚、阻止重启或宣称版本因果。
