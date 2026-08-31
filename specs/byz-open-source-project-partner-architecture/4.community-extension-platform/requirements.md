# Community Extension Platform — 需求规格

## 概述

提供不暴露 Pi 内部和 Project 数据库的社区扩展协议，支持声明式资源与受信任代码、来源锁定、Capability 授权和高风险首次使用确认。

## 项目信息

- 项目名: pi-monorepo
- 架构类型: Pi 派生的 npm workspace monorepo
- 上下文范围: full（security_sensitive）

## 需求版本

| 日期 | 版本 | 说明 |
| --- | --- | --- |
| 2026-08-30 | v1 | 初始需求 |

## 用户故事

- 作为社区贡献者，我想编写 Workflow、Skill、Provider、外部集成和导入导出器，而不修改 BYZ Core。
- 作为用户，我想在安装时看见扩展来源、信任等级和权限，并在外部写入时再次决定。
- 作为维护者，我想锁定精确来源并阻止扩展直接确认决策、接受记忆或读取凭证明文。
- 作为扩展开发者，我想使用稳定的 `@aibyzero/byz/extension` API，而不依赖 Pi Context。

## 功能需求

1. [F-001] 扩展必须声明 `declarative` 或 `trusted-code` 信任等级；代码扩展安装时必须明确提示其拥有当前系统用户权限。
2. [F-002] 每个扩展必须提供 schema v1 Manifest，声明身份、版本、API 版本、入口、所需/可选 Capability 和贡献点。
3. [F-003] BYZ 管理 API 必须按扩展身份、精确版本/commit、manifest hash、来源、Capability 和 project/global scope 校验授权。
4. [F-004] 低/中风险权限在安装时批准；通过 BYZ broker/API 的外部写入、发布、凭证使用和正式记忆读取在首次使用时再次确认；trusted-code 绕过 broker 的系统调用不在 Capability 强制范围内并必须明确警告。
5. [F-005] npm 扩展必须锁定精确版本、完整依赖闭包 integrity 和安装树 digest，Git 扩展必须锁定完整 commit 与安装树 digest，本地扩展只能作为显式开发来源。
6. [F-006] 共享扩展锁不得包含用户授权或本机绝对路径；授权必须保存在本机私有数据库。
7. [F-007] 公共 Extension API 不得提供决策确认、记忆接受/删除、项目删除、凭证明文和通用 Shell 能力。
8. [F-008] 凭证使用必须优先通过 BYZ 请求代理或不可导出的句柄完成，扩展不得通过 API 读取明文。
9. [F-009] BYZ 必须提供 extension list/inspect/install/permissions/revoke/update/remove/doctor 命令和本地审计事件。
10. [F-010] 首期必须提供一个无网络 Project Summary Exporter 和一个仅使用假凭证/测试端点的外部集成样例。
11. [F-011] Extension API v1 在同一 minor 周期内保持兼容；破坏性变化必须先弃用并提供迁移说明。

## 非功能需求

- 安全: Capability 只声明为 BYZ API 边界，不宣传为 OS sandbox。
- 供应链: 安装禁用 lifecycle scripts；来源、hash 或权限变化后旧授权失效。
- 隐私: 默认只提供结构化 Project Summary，不提供会话全文、文件正文、候选记忆、诊断原始事件和其他项目数据。
- 可维护性: 公共 SDK 不导出 Pi、SQLite 或内部 Session 类型。
- 开发体验: 本地扩展首期通过显式 `/reload` 或重启加载，不自动监听文件。

## 验收标准

- [ ] [AC-001] 声明式扩展不能声明可执行入口；其资源仍按不可信指令和项目 trust 处理。
- [ ] [AC-002] 代码扩展安装提示明确说明其可直接使用当前用户系统权限，Capability 不是系统沙箱。
- [ ] [AC-003] Manifest 缺字段、枚举非法、API 版本不兼容或声明未知 required Capability 时拒绝安装。
- [ ] [AC-004] 未声明或未授权 Capability 的 BYZ API 调用失败，且不会返回受保护数据。
- [ ] [AC-005] 通过 BYZ broker/API 的外部写入首次调用展示目标、动作、拟发送数据类别和不发送类别；用户可允许一次、项目内记住或拒绝。trusted-code 直接使用 Node/OS API 的动作无法被首期协议拦截，安装提示必须明确该限制。
- [ ] [AC-006] 版本、Git commit、来源、manifest hash、完整依赖闭包、安装树 digest 或权限集合变化后旧授权不再生效。
- [ ] [AC-007] npm 浮动版本、Git branch/tag 不能写入最终锁；完整依赖图逐包记录 integrity，安装过程不执行 lifecycle scripts。
- [ ] [AC-008] 本地绝对路径只保存在用户私有配置，界面持续标记 development extension；内容 hash 变化后重新确认信任。
- [ ] [AC-009] `credential.<service>:use` 不返回明文凭证；请求代理日志不记录授权头和正文。
- [ ] [AC-010] 扩展不能通过公共 API确认 Decision、接受/删除 Memory、删除 Project 或执行任意 Shell。
- [ ] [AC-011] 撤销授权在 permission transaction 中递增 grant generation；高风险动作从 pending 转 executing 时必须原子复核 generation，撤销后拒绝新调用并取消仍 pending 的动作。
- [ ] [AC-012] 项目级授权不能访问其他项目；global scope 必须单独批准。
- [ ] [AC-013] 共享 lock 可安全提交 Git，本机 permissions 数据不进入共享文件。
- [ ] [AC-014] `@aibyzero/byz/extension` 类型和运行时契约不暴露 Pi ExtensionContext、SQLite 表和 Session 内部对象。
- [ ] [AC-015] 两个官方样例可在无真实凭证和无生产外部写入的测试环境运行。
- [ ] [AC-016] Extension API v1 的任何破坏性变化在同一 minor 周期内均被兼容检查阻止；当前 minor 只能弃用，最早在下一允许的 minor 移除并提供迁移说明。

## 依赖

- Feature 1 的 Command Registry、构建/exports 和通用 managed-resource 能力。
- Feature 2 的 Project Summary Port 和本机私有存储。
- Feature 3 的 Memory/Decision 权限边界。
- 现有 Pi package/resource loading 能力。

## 开放问题

- 无阻塞问题。插件市场、账号体系和真正的进程/OS 沙箱不在首期范围。
