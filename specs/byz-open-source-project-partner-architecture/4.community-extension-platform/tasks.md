# Community Extension Platform — 任务清单

## 任务版本

| 日期 | 版本 | 说明 |
| --- | --- | --- |
| 2026-08-30 | v1 | 初始任务 |

## 项目信息

- 项目名: pi-monorepo
- 架构类型: BYZ extension SDK/host/capability broker
- specs 路径: `specs/byz-open-source-project-partner-architecture/4.community-extension-platform/`

## 任务列表

### 防护网基线

- [ ] T-001: 在修改前运行并记录 `./test.sh`、BYZ package tests、workflow switching 和 public package import smoke ~1h
  AC: AC-001, AC-014

### Manifest、来源与 SDK

- [ ] T-002: 实现 Manifest v1 类型/validator、declarative/trusted-code 规则、Capability catalog 和 `defineByzExtension`，并建立 `@aibyzero/byz/extension` 子路径 ~1h
  AC: AC-001, AC-002, AC-003, AC-014
- [ ] T-003: 实现公共 artifact materializer：隔离安装目录、禁用 lifecycle scripts、规范化 executable tree digest 和完整 identity 构造 ~1h
  AC: AC-006, AC-007
- [ ] T-004: 实现 npm exact source resolver、完整 dependency closure 解析与逐包 integrity lock，并交给 artifact materializer ~1h
  依赖: T-003
  AC: AC-006, AC-007
- [ ] T-005: 实现 Git full-commit 与 local-development source resolvers；Git 锁依赖图，本地路径只入私有配置且 hash 变化要求重新信任 ~1h
  依赖: T-003
  AC: AC-006, AC-007, AC-008
- [ ] T-006: 实现可提交的 `.byz/extensions.lock.json` 与本机私有 artifact/local-path 配置；identity 明确绑定 version/commit、source、manifest hash、完整 dependency closure、tree digest 和 permission set ~30min
  依赖: T-003, T-004, T-005
  AC: AC-006, AC-008, AC-013

### Capability 与扩展运行

- [ ] T-007: 实现 permissions SQLite、artifact/scope/grant generation、安装授权和高风险 action 队列原子 claim/revoke ~1h
  AC: AC-004, AC-005, AC-006, AC-011, AC-012
- [ ] T-008: 实现 capability-scoped Project/Task/Artifact/Evidence/Event/Memory facades，所有调用逐次校验且不暴露确认、删除、Shell、Pi/SQLite/Session ~1h
  依赖: T-002, T-007
  AC: AC-004, AC-010, AC-012, AC-014
- [ ] T-009: 实现 external request/credential broker、首次敏感使用确认、once/project/global scope 和脱敏审计；明确 trusted-code 直接 Node/OS I/O 不受 broker 约束 ~1h
  依赖: T-007
  AC: AC-002, AC-005, AC-009, AC-011, AC-012
- [ ] T-010: 实现 Extension Host 生命周期、managed declarative resources、trusted-code load/unload、撤销和显式 `/reload`；不得启动 watcher ~1h
  依赖: T-002, T-006, T-007, T-008, T-009
  AC: AC-001, AC-002, AC-008, AC-011
- [ ] T-011: 通过 Command Registry 实现 extension list/inspect/install/permissions/revoke/update/remove/doctor 和结构化本机审计事件 ~1h
  依赖: T-010
  AC: AC-003, AC-005, AC-006, AC-011, AC-013

### 样例、兼容与测试

- [ ] T-012: 修改 BYZ package image 构建，使 Pi examples 与 BYZ extension examples 确定性合并且不会互相覆盖，并加入 packed-file contract ~30min
  依赖: T-002
  AC: AC-014, AC-015
- [ ] T-013: 增加无网络 Project Summary Exporter 与 loopback/假凭证 Test External Integration 样例，禁止真实生产副作用 ~1h
  依赖: T-008, T-009, T-010, T-012
  AC: AC-015
- [ ] T-014: 增加 Extension API v1 导出快照/兼容检查，同一 minor 阻止任何 breaking change并校验 deprecation/migration 规则 ~30min
  依赖: T-002
  AC: AC-016
- [ ] T-015: 增加 manifest fuzz、各 identity 字段参数化失效、供应链来源、scope isolation、明文凭证拒绝、broker 首次确认、revoke/claim race、SDK/examples pack 测试；运行 `npm run check`、`./test.sh` 和仓库外 tarball smoke ~1.5h
  依赖: T-003, T-004, T-005, T-006, T-007, T-008, T-009, T-011, T-013, T-014
  AC: AC-003, AC-004, AC-005, AC-006, AC-007, AC-009, AC-010, AC-011, AC-012, AC-013, AC-014, AC-015, AC-016

## 依赖关系

```text
T-001 → T-002,T-003,T-007
T-003 → T-004,T-005
T-003,T-004,T-005 → T-006
T-002,T-007 → T-008
T-007 → T-009
T-002,T-006,T-007,T-008,T-009 → T-010 → T-011
T-002 → T-012
T-008,T-009,T-010,T-012 → T-013
T-002 → T-014
T-003,T-004,T-005,T-006,T-007,T-008,T-009,T-011,T-013,T-014 → T-015
```

## 风险点

- trusted-code 拥有系统用户权限；首期 Capability 只约束 BYZ API，不是系统沙箱。
- artifact identity 必须覆盖完整依赖闭包和 executable tree，不能只锁顶层包。
- revoke 与 action claim 必须在同一 permission transaction 中使用 grant generation。
- BYZ extension examples 必须与现有 Pi examples 确定性合并，不能被 build 覆盖。
- Extension API v1 同一 minor 内不得移除或破坏已有导出。
