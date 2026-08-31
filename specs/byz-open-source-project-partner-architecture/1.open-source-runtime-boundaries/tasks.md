# Open Source Runtime Boundaries — 任务清单

## 任务版本

| 日期 | 版本 | 说明 |
| --- | --- | --- |
| 2026-08-30 | v1 | 初始任务 |
| 2026-08-30 | v2 | 作废已达审查上限的 T-002，新增安全构建、package image 与统一发布任务 |
| 2026-08-30 | v3 | 作废可超时 lease 的 T-012，新增进程启动身份锁任务 |
| 2026-08-30 | v4 | 归档已达审查上限的旧任务声明，以 T-016 修复激活后 `unknown` 未失败关闭的问题 |
| 2026-08-30 | v5 | 归档第二轮被阻塞的 T-013，以 T-017 修复可移植输出冲突和 promotion 后清理安全 |
| 2026-08-30 | v6 | 归档第二轮被阻塞的 T-017，以 T-018 修复非相邻祖先冲突和源码 symlink provenance |
| 2026-08-30 | v7 | 归档第二轮被阻塞的 T-014，以 T-019 建立 receipt 绑定、消费前展开上限和私有 pack destination |
| 2026-08-30 | v8 | 归档第二轮被阻塞的 T-019，以 T-020 收敛 CI 单一制品生产链和锁内最终围栏 |
| 2026-08-31 | v9 | 归档第二轮被阻塞的 T-003，以 T-021 修复普通 Pi precedence 泄漏和启动期 managed theme 静默丢弃 |
| 2026-08-31 | v10 | 归档第二轮被阻塞的 T-004，以 T-022 建立显式最小能力 Pi facade 并迁移现有 BYZ 功能 |

## 项目信息

- 项目名: pi-monorepo
- 架构类型: npm workspace monorepo
- specs 路径: `specs/byz-open-source-project-partner-architecture/1.open-source-runtime-boundaries/`

## 任务列表

### 防护网基线

- [x] T-001: 在修改前运行并记录仓库非 E2E 回归 `./test.sh`、BYZ package tests 和现有 public-package/packed-runtime 检查；失败则先区分存量失败与环境阻塞，不修改产品行为 ~1h
  AC: AC-007, AC-010, AC-011

### 已归档审查历史（非可执行任务）

- `T-002` — v2 作废：第二轮独立审查仍有阻塞项，后续范围拆为 T-012 至 T-014。
- `T-012` — v3 作废：第二轮独立审查证明超时 lease 仍允许旧进程复活，后续改为 T-015。
- `T-015` — v4 作废：第二轮独立审查发现激活后选举和 publication fence 会忽略 competing `unknown` owner；保留两轮 handoff/review 证据，不创建 attempt 3。
- `T-013` — v5 作废：第二轮独立审查发现编译输出冲突检查不符合可移植文件系统语义，且 pointer promotion 后的围栏失败可能触发清理 current generation；保留两轮 handoff/review 证据，不创建 attempt 3。
- `T-017` — v6 作废：第二轮独立审查发现 portable ancestor 检查依赖排序相邻性，且编译前未验证 BYZ `src` 的 symlink provenance；保留两轮 handoff/review 证据，不创建 attempt 3。
- `T-014` — v7 作废：第二轮独立审查发现 CI smoke 尚未与 publish 绑定同一 tarball 字节，tar 在解压前没有展开规模上限，且 npm 仍使用可在 check/use 之间重定向的 destination pathname；保留两轮 handoff/review 证据，不创建 attempt 3。
- `T-019` — v8 作废：第二轮独立审查确认 tar/receipt、私有 destination、smoke/publish snapshot 和 publish ownership 防线已成立，但 release dry-run 仍生产 artifact A、CI 随后独立生产 artifact B，且 dry-run pack 未在同一进程身份锁内完成最终 current/receipt 围栏；保留两轮 handoff/review 证据，不创建 attempt 3。
- `T-003` — v9 作废：第二轮独立审查确认 capability token、多 owner snapshot、空 discovery owner、project-trust preload/reload 和运行期 theme 拒绝已成立，但普通 Pi 的 additional/discovered precedence 被全局改成 BYZ 顺序，且 managed startup theme 仍被静默丢弃；保留两轮 handoff/review 证据，不创建 attempt 3。
- `T-004` — v10 作废：第二轮独立审查确认 product profile、Pi Core 产品命名清理和静态依赖门禁已成立，但 `createPiExtensionAdapter()` 仍以透明 Proxy 暴露完整 Pi Extension API，未形成 design 声明的 runtime/session/model/resource/UI ports；保留两轮 handoff/review 证据，不创建 attempt 3。

### 构建与组合边界

- [x] T-016: [NEW] 在 T-015 草稿基础上完成不可移动 owner token + PID + `processStartId` 生命周期锁：首次竞争、激活后最终选举、持有校验和 publication fence 共用失败关闭规则，任何其他完整 owner 的 `unknown` 都阻止返回或使用 lock handle；增加可控的 post-activation unknown 并发回归，证明不会返回两个可发布 handle，同时保留 no-follow 输出边界、死亡/PID 复用恢复、旧 owner fencing 和可移植 workflow 校验 ~30min
  模块: `packages/byz/scripts/build-support.mjs`、`packages/byz/test/build-safety.test.mjs`、`packages/byz/test/build.test.mjs`
  AC: AC-013
- [x] T-018: [NEW] 在 T-017 草稿基础上完成生产 build 编排并保留已通过的锁、metadata、复制源、image、publication state 和 current cleanup 防线；把 portable path 重叠判定改为 segment trie 或每项全祖先 prefix 查询，证明 `A.js`、`a.js-foo.js`、`a.js/b.js` 不能绕过文件/目录冲突；在编译器启动前 no-follow 递归验证 manifest `src` 根、所有祖先和叶子，拒绝指向 package 外 JavaScript/TypeScript 的 symlink、junction 与非普通条目；使用隔离真实生产编排验证完整源码入口、workspace/image metadata、首次/并发/中断构建、promotion 后 `unknown`、异常 current，以及新增的非相邻祖先和外部源码 symlink 反例 ~1h
  依赖: T-016
  模块: `packages/byz/scripts/build-support.mjs`、`packages/byz/scripts/build.mjs`、build manifest/tsconfig、`packages/byz/package.json`、BYZ build/package tests
  AC: AC-009, AC-010, AC-011, AC-013, AC-015, AC-016
- [x] T-020: [NEW] 在 T-019 草稿及其已通过的 tar/receipt、私有 destination、snapshot、publish ownership 和回归防线上完成单一制品生产链：让 CI artifact step 只调用一次 release dry-run，由 dry-run 取得进程身份构建锁并在同一 lock handle 下完成 current/image 校验、npm pack、receipt 生成与验证、最终 ownership/current/generation 围栏，再以机器可读结果返回唯一 tarball/receipt/generation/SHA-256；移除 CI 后续独立 pack 调用，使仓库外 smoke 与 publish 直接消费该结果；publish 继续独立捕获和验证同一 receipt 字节；增加 pack 边界内 current 切换或锁丢失必须失败且不输出候选路径，以及 workflow 只能存在一个制品生产调用的确定性回归 ~45min
  依赖: T-018
  模块: `scripts/byz-release.mjs`、`.github/workflows/byz-release.yml`、`packages/byz/scripts/pack.mjs`、artifact verifier 与 release/packed-runtime tests
  AC: AC-010, AC-011, AC-014, AC-017, AC-018
- [x] T-021: [NEW] 在 T-003 草稿及已通过的 capability-token、多 owner snapshot、空 discovery owner、project-trust preload/reload、伪造/陈旧 token 拒绝和 BYZ workflow switching 防线上完成产品中立资源语义：恢复普通 Pi 未配置场景下 v9 前的 auto-discovered/additional skill/prompt collision 顺序；增加产品无关的显式 additional precedence 配置并只由 BYZ 组合根为静态 workflow 选择 `before`，动态 workflow 继续使用 managed owner precedence；在 startup、reload 和 command 三条路径中，于任何资源或 system prompt 副作用前拒绝 managed owner 的非空 `themePaths`；增加普通 Pi collision、managed startup/reload theme、双 owner 替换与 empty-owner command 回归 ~45min
  依赖: T-020
  模块: `packages/coding-agent` resource loader、agent session、extension runner/types 与入口配置；`packages/byz` CLI/组合根、workflow adapter
  AC: AC-004, AC-005, AC-019
- [ ] T-022: [NEW] 在 T-004 草稿及已通过的 product profile、Pi Core 产品命名清理、lexer 依赖门禁和 BYZ 组合根装配防线上，把透明 `createPiExtensionAdapter()` 替换为显式 plain-object port facade：完整 Pi Extension API 只能保留在 `adapters/pi` 闭包内，Adapter 将生命周期事件和 command context 转换为产品无关事件/上下文，组合根分别向 diagnostics、workflow、Fast、Prewalk 和 Conversation 注入最小 capability slice；功能 factory 不再接受 raw Pi context，facade 不含未声明属性或 raw handle；保留 ordinary Pi profile 默认行为，并增加每个功能的允许能力、未声明能力不可访问、managed replacement 不向非 workflow 功能泄漏及既有行为回归 ~1h
  依赖: T-021
  模块: `packages/byz/src/application/ports/**`、`packages/byz/src/adapters/pi/**`、BYZ CLI 组合根及 diagnostics/workflow/Fast/Prewalk/Conversation extension shell；`packages/coding-agent` product profile；架构门禁与 adapter tests
  AC: AC-003, AC-004, AC-020
- [ ] T-005: 建立 Command Registry/CommandResult 和 bootstrap 组合根，将 update、workflow、diagnostics、Fast 参数与 Pi passthrough 迁移到单次解析和统一退出映射 ~1h
  依赖: T-022
  AC: AC-006

### 对话与开源治理

- [ ] T-006: [CHANGED v10] 在 T-022 建立的 Conversation lifecycle/session/model/presentation ports 内，只负责 Conversation controller、progress projector、Presenter、Footer、语言目录和结构化 interaction policy 拆分，保持现有终端行为并移除关键词正文改写；不得重新引入 raw Pi context ~1h
  依赖: T-022
  AC: AC-007, AC-020
- [ ] T-007: 实现 Conversation Preferences Repository 的 schema、私有权限、损坏隔离、跨进程锁或 revision/CAS，并迁移 language/detail settings ~30min
  AC: AC-008
- [ ] T-008: 增加 `UPSTREAM.md`、BYZ `CONTRIBUTING.md`、`SECURITY.md`、NOTICE 和 release provenance，明确代码所有权及人工审查责任 ~30min
  AC: AC-001, AC-002
- [ ] T-009: 实现绑定 release commit、仅接受受保护 CI environment/可信签名审批的许可证发布门禁及负向测试；普通仓库 marker 不得通过 ~1h
  依赖: T-008
  AC: AC-012

### 集成与测试

- [ ] T-010: [CHANGED v10] 增加 managed-owner 隔离、静态依赖方向、运行时最小 capability facade、命令结果、Conversation 行为和并发偏好写入回归测试 ~1h
  依赖: T-021, T-022, T-005, T-006, T-007
  AC: AC-003, AC-004, AC-005, AC-006, AC-007, AC-008, AC-020
- [ ] T-011: 运行 `npm run check`、`./test.sh`、BYZ build/package tests，并从仓库外 smoke 最终 tarball 的 CLI、runtime exports、assets、docs/examples 和 workflows ~1h
  依赖: T-008, T-009, T-010
  AC: AC-010, AC-011, AC-012

## 依赖关系

```text
T-001 → T-016 → T-018 → T-020
T-020 → T-021,T-007,T-008
T-021 → T-022
T-022 → T-005,T-006
T-008 → T-009
T-021,T-022,T-005,T-006,T-007 → T-010
T-008,T-009,T-010 → T-011
```

## 风险点

- Pi 通用 hook 泛化会同时影响 Pi 与 BYZ resource loading，必须保持 owner isolation 和资源 precedence。
- 许可证审批是人工发布门禁；实现只能验证可信审批来源，不能替代法律判断。
- Conversation 重构与 Preference Repository 分开交付，避免 UI 回归和并发存储缺陷互相遮蔽。
- T-002、T-012、T-015、T-013、T-017、T-014、T-019、T-003 与 T-004 的两轮审查证据保持不可变；T-016、T-018、T-020、T-021 已通过独立审查，T-022 是经人工裁决新增的 T-004 替代任务，必须重新建立 handoff 与 N4，不创建任何旧任务 attempt 3。
- Pi Adapter 不得用透明 Proxy、泛型原样返回或公开 raw handle 假装形成边界；组合根必须按功能裁剪 facade，managed replacement 等高权限只能进入明确声明的 workflow slice。
- 普通 Pi 未显式配置时必须保留 v9 前 additional/discovered 冲突顺序；BYZ 的 `before` 只能从产品无关组合根配置产生，不能再次修改共享默认值。
- Managed theme 在 startup、reload 和 command 必须一致失败关闭，并保证失败前没有 skills/prompts、system prompt 或 `resources_changed` 部分副作用。
- 进程身份 probe 返回 `unknown` 时必须在首次竞争、激活后选举、持有校验和发布围栏全部失败关闭；不能为了自动恢复重新引入 TTL takeover。
- 源码 workspace metadata 与发布 image metadata 必须成对验证，防止修复一侧入口时破坏另一侧。
- 编译输出、metadata 和保留 runtime 目标不得使用宿主文件系统行为判冲突；portable path ancestor 检查必须覆盖全部组合，不能只比较精确字符串或排序相邻项。
- BYZ `src` 必须在编译前 no-follow 递归验证；编译后的普通文件不能作为外部源码 symlink provenance 的替代证据。
- pointer promotion 后的围栏异常既不能伪装为“未发布”也不能触发删除 current；无法证明 current identity 时应保留 generation。
- tarball pathname、name/version 和 smoke 成功都不能单独证明制品身份；release dry-run 必须是 CI 唯一制品生产者，receipt SHA-256 必须贯穿它返回的同一 tarball、smoke 与 publish。
- tar 安全检查必须发生在解压和整文件读取前；压缩大小上限不能替代逐 entry 与总展开大小上限。
- npm pack 只能写入 pack 自己原子创建的 output-root 外私有目录，不能校验一个 destination realpath 后继续使用原始可变 pathname。
