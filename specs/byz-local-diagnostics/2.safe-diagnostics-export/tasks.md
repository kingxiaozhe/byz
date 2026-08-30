# Safe Diagnostics Export — 任务清单

## 任务版本

| 日期 | 版本 | 说明 |
| --- | --- | --- |
| 2026-08-30 | v1 | 初始任务 |

## 项目信息

- 项目名: pi-monorepo
- 架构类型: Node.js npm workspace monorepo
- specs 路径: `specs/byz-local-diagnostics/2.safe-diagnostics-export/`

## 任务列表

### 防护网基线

- [x] T-001: 复跑 foundation diagnostics 命令、reader、privacy validator、clear 和并发 writer 测试，记录导出改动前基线 ~20min

### 安全导出

- [x] T-002: 实现 export plan、交互/非交互确认和独立二次白名单校验，默认只生成聚合摘要并覆盖未知/损坏/敏感字段失败关闭测试 ~1h
- [x] T-003: 实现私有临时目录、固定 manifest/summary/privacy report、父目录 identity 复核、原子 rename、拒绝覆盖/符号链接和失败清理 ~1.5h
- [x] T-004: 将 `diagnostics export [--since] [--output] [--confirm]` 接入 BYZ 命令路由并覆盖退出码、取消、无网络和不自动加入 AI 上下文 ~1h

### 回归与文档

- [x] T-005: 增加导出与运行期 writer 并发测试，确认导出不使用共享阻塞锁；复跑 T-001 基线 ~1h
- [x] T-006: 更新 BYZ README/CHANGELOG，说明默认导出内容、预览、确认、失败关闭和不自动上传 ~20min

## 依赖关系

- 本 feature 依赖 `1.local-diagnostics-foundation` 完成。
- T-002、T-003 依赖 T-001。
- T-004 依赖 T-002、T-003。
- T-005 依赖 T-004。
- T-006 依赖 T-005。

## AC 映射

| 任务 | AC |
| --- | --- |
| T-002 | AC-001, AC-002, AC-003, AC-004, AC-005 |
| T-003 | AC-006, AC-007, AC-009 |
| T-004 | AC-001, AC-005, AC-008, AC-011 |
| T-005 | AC-008, AC-010 |

## 风险点

- 导出器不得复制原始 JSONL，即使用户请求“更完整”也必须走需求变更审批。
- 自定义父目录在导出期间可能被替换，最终 rename 前必须复核 identity。
- 导出是显式前台命令，可以等待本地读取；运行期 writer 仍不得等待导出或共享锁。
