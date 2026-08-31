# Community Extension Platform — 技术设计

## 设计版本

| 日期 | 版本 | 说明 |
| --- | --- | --- |
| 2026-08-30 | v1 | 初始设计 |

## 项目架构

- 架构类型: BYZ public SDK + extension host + source resolver + local permission store。
- 涉及层: package exports、manifest、installer、capability broker、Project ports、credentials、CLI、审计。
- 设计基准: 无 UI 视觉基准；权限卡和信任警告按文本契约验收。

## 功能模块设计

### 模块 1：Manifest 与信任等级

```ts
interface ByzExtensionManifestV1 {
	schemaVersion: 1;
	id: string;
	name: string;
	version: string;
	apiVersion: "1";
	kind: "declarative" | "trusted-code";
	entry?: string;
	permissions: {
		required: Capability[];
		optional: Capability[];
	};
	contributes: ExtensionContributions;
}
```

`declarative` 禁止 entry，只加载静态 workflow/skill/prompt/import mapping；这些内容仍是不可信指令。`trusted-code` 必须有 package 内相对 entry，并在安装/升级时显示同进程系统权限警告。

Manifest validator 使用封闭 schema 和已知 required capability；未知 optional capability 可忽略并提示兼容性，未知 required 直接拒绝。

### 模块 2：来源解析与共享锁

支持：

- npm：精确版本，解析完整依赖图并逐包记录 version/integrity；
- Git：解析后保存 repository、40 位 commit 和锁定依赖图；
- local：仅 development mode，绝对路径写用户私有配置，shared lock 只保存 extension id/hash 和 local marker。

每个扩展安装到隔离目录，完成后对规范化 executable tree 计算 digest；artifact identity 同时绑定顶层来源、完整 dependency closure、manifest hash、tree digest 和 permission set。

安装统一禁用 lifecycle scripts。浮动 npm range、Git branch/tag 不能成为最终 lock。安装内容落入 BYZ 私有 extension store，校验 realpath 和 manifest/package hash。

`.byz/extensions.lock.json` 只保存可共享来源与 hash；`~/.byz/permissions.sqlite` 保存本机 grants。版本、commit、source、manifest hash 或 permission set 变化后创建新 artifact identity，旧 grants 不匹配。

### 模块 3：Capability Broker

公共 API context 是 capability-scoped facade，不暴露 DB、Pi Context 或 Session：

```ts
interface ByzExtensionContext {
	project: ProjectExtensionApi;
	memory: MemoryExtensionApi;
	external: ExternalRequestApi;
	events: ExtensionEventApi;
}
```

每次 API 调用校验 extension artifact identity、scope、required capability、grant generation 和 grant。扩展只能 propose task/memory；Decision confirm、Memory accept/delete、Project delete、credential reveal 和 shell execute 不存在于 public interface。

该校验只约束 broker-mediated BYZ API。trusted-code 与 BYZ 同进程，仍可直接调用 Node/OS API；首期协议不得声称能拦截这类访问，安装与权限卡必须明确区分“BYZ API 授权”和“系统代码信任”。

只读 Project Summary 按 allowlist 投影，不返回会话全文、文件正文、候选记忆、诊断 raw event 和其他项目数据。

### 模块 4：分级授权

安装时确认低/中风险 required 权限。高风险 capability 在首次使用时创建 action request：

```text
external.*:write
external.*:publish
credential.*:use
memory.project:read
memory.global:read
```

确认卡包含 extension、目标、动作、拟发送数据类别、不发送类别和拒绝结果。选择为 once/project/global；global 单独确认。授权绑定 artifact identity，permission escalation 不能继承。

### 模块 5：凭证与外部请求

`credential.<service>:use` 只允许调用 BYZ external request broker 或不可导出 handle。Broker 注入 credential，执行 URL/service allowlist、超时、redirect 和 payload classification；不向扩展返回 credential。审计只记录 service/action/outcome，不记录 headers、body 和 response content。

由于 trusted-code 可绕过 broker 访问系统，UI 和文档明确 capability 不是 sandbox。真正的进程/OS sandbox 不在首期。

### 模块 6：Extension host 与生命周期

Host 从 lock 解析 artifact，验证 hash/API version/grant 后加载。managed owner 处理声明式 resources；trusted code 通过稳定 SDK factory 注册 contributions。

Permission DB 为每个 artifact/scope 保存 grant generation，高风险 action 与 generation 同表持久化。worker 只能在 transaction 中将 `pending → executing`，并复核当前 grant generation；撤销 transaction 递增 generation 并取消仍 pending 的 action，从而关闭并发启动窗口。撤销后拒绝新 API 调用、卸载下次会话资源，不删除既有 project artifacts。已 executing 且结果未知的动作标记 uncertain，不自动重试。

本地扩展仅显式 `/reload` 或重启；不启动 watcher。

### 模块 7：SDK 与命令

`packages/byz/package.json` 新增子路径：

```text
@aibyzero/byz/extension
```

导出 manifest types、validator、defineByzExtension 和 scoped context types。v1 compatibility check 阻止同一 minor 周期内任何破坏性导出变化；当前 minor 只能标记 deprecated，最早在下一允许的 minor 移除，并要求迁移说明。

命令：

```text
byz extension list|inspect|install|permissions|revoke|update|remove|doctor
```

所有命令复用 Feature 1 Command Registry。安装/删除/权限变化写本机 extension audit events，不写 diagnostics raw payload。

### 模块 8：官方样例

1. Project Summary Exporter：声明式/受限代码样例，无网络，将 allowlisted summary 输出到用户指定安全路径。
2. Test External Integration：只连接 loopback fixture 或测试端点，使用假 credential handle，演示首次写入确认和撤销。

样例不得要求真实账号、生产写入或付费 token。

## Capability 合同

| Capability | 风险 | 可执行行为 |
| --- | --- | --- |
| `project.summary:read` | 低 | 读取 allowlisted summary |
| `project.task:read` | 低 | 读取任务状态 |
| `project.task:propose` | 中 | 提议任务，不确认 |
| `project.artifact:read/write` | 低/中 | 通过安全路径 broker 读引用/写产物 |
| `project.evidence:read/write` | 低/中 | 读写结构化证据 |
| `project.event:subscribe` | 低 | 订阅脱敏领域事件 |
| `memory.candidate:propose` | 中 | 只创建候选 |
| `memory.project/global:read` | 高 | 用户首次使用确认后读正式记忆 |
| `external.<service>:read` | 中 | broker 只读请求 |
| `external.<service>:write/publish` | 高 | 首次使用确认 |
| `credential.<service>:use` | 高 | broker 使用，不返回明文 |

## 安全考虑

- 所有来源固定到包含完整 dependency closure 与 executable tree digest 的不可变 artifact identity；安装脚本禁用。
- shared lock 与 private grants 分离。
- permission check 在每次 BYZ API call 执行，不能只在加载时检查；高风险队列 claim 与 grant generation 必须同 transaction 校验。
- local extension path 不能写入共享文件。
- trusted code 提示真实 OS 权限，不声称 containment。
- 外部写入结果不确定时不自动重试。

## 波及面

| 改动位置 | 直接调用方 | 可能受影响的老功能 | 回归保护 |
| --- | --- | --- | --- |
| 新 `extension/**`、`application/extension/**` | extension commands/host | package startup、资源加载 | manifest/host integration tests |
| `packages/byz/package.json` exports/files | npm consumers | 根 runtime export、rpc-entry | packed import smoke |
| BYZ build/release scripts | npm pack | bundled runtime与工作流 | public package tests |
| managed resource Adapter | workflow/skill loading |现有 cm/cm-plugin switching | workflow-switch regressions |
| Project/Memory ports | third-party context | 私有状态暴露 | capability isolation tests |
| credential/external adapter | provider/auth storage | 凭证安全、网络行为 | loopback broker tests |

## 技术决策

| 决策 | 选项 | 理由 |
| --- | --- | --- |
| 安全模型 | declarative + trusted-code | 诚实反映当前无 OS sandbox |
| 授权时机 | install + first sensitive use | 降低噪声同时保护外部副作用 |
| 来源 | npm exact/Git commit/local dev | 可追溯且不先建市场 |
| SDK 发布 | BYZ package subpath | 首期避免新增 package/release 通道 |
| 自动重载 | 首期不做 | 避免 watcher、hash 与授权竞态 |
| 示例 | 无网络 exporter + fixture integration | 可验证协议，不需要真实凭证 |
| API 兼容 | v1 minor 内兼容 + deprecation | 给社区稳定预期而不过早承诺长期 ABI |
