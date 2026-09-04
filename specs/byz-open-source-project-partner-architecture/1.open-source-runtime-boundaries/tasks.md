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
| 2026-09-02 | v11 | 归档第二轮被阻塞的 T-022；新增 T-023 关闭三类具体边界缺口，并限定本轮 P1 执行范围 |
| 2026-09-02 | v12 | 归档第二轮被阻塞的 T-023；新增 T-025 关闭 port source binding、namespace creator 与 Reflect.set 三项剩余边界 |
| 2026-09-02 | v13 | 归档第二轮被阻塞的 T-025；新增 T-026 精确解析 creator provenance、re-export alias 与 Reflect.defineProperty |
| 2026-09-02 | v14 | 归档第二轮被阻塞的 T-005；新增 T-027 收口 update 输出溢出的有界终止协议 |
| 2026-09-03 | v15 | 归档第二轮被阻塞的 T-007；新增 T-028 以字段分区原子 cell 消除跨字段并发覆盖与持久锁 |
| 2026-09-03 | v16 | 归档第二轮被阻塞的 T-028；新增 T-029 按 BYZ 非权限沙箱边界收口字段分区存储 |

## 项目信息

- 项目名: pi-monorepo
- 架构类型: npm workspace monorepo
- specs 路径: `specs/byz-open-source-project-partner-architecture/1.open-source-runtime-boundaries/`
- 优先级: P1（Feature 5/6 架构前置）
- 执行状态: `[APPROVED]` v14 及后续必要替代任务已获批量人工授权；本轮只执行明确标为 P1 的任务

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
- `T-022` — v11 作废：第二轮独立审查确认主要 facade 已成立，但 architecture gate 仍可被局部 factory alias/computed 或 accessor escape 绕过，module-global model brand 可跨 live Session 接受引用，Prewalk 在 awaited realpath 后未重验 trust；保留两轮 handoff/review 证据，不创建 attempt 3。
- `T-023` — v12 作废：第二轮独立审查确认 Session-lineage model handle、Fast identity restore、Prewalk trust recheck、局部/container factory alias 和直接/static raw writes 已成立，但 port 参数仍未绑定真实 `createPiExtensionPorts(pi)` symbol，namespace-import creator 未解析，`Reflect.set` raw escape 未拦截；保留两轮 handoff/review 证据，不创建 attempt 3。
- `T-025` — v13 作废：第二轮独立审查确认 exact const port source、namespace/static creator、`Reflect.set`、Windows path 和 resolved-name isolation 已成立，但 re-export alias 未追溯原始 creator，`Reflect.defineProperty` 未拦截，同名无关 import 未绑定 canonical source；保留两轮 handoff/review 证据，不创建 attempt 3。
- `T-005` — v14 作废：第二轮独立审查确认 CommandResult、单次 BYZ 参数解析、Pi passthrough 和 update 子进程输出捕获已成立，但输出溢出后只发送 SIGTERM 并无界等待 close；保留两轮 handoff/review 证据，不创建 attempt 3。
- `T-007` — v15 作废：第二轮独立审查确认 descriptor bounded read、corrupt snapshot、异步重读、strict schema、模式修复和进程身份恢复方向，但目录 symlink、publication/release check-use、锁 metadata crash durability 与默认诊断仍未关闭；保留两轮 handoff/review 证据，不创建 attempt 3。
- `T-028` — v16 作废：第二轮独立审查确认独立 cell、Linux descriptor anchor、pre/post file identity、私有权限和默认诊断方向，但把任意同用户目录替换纳入跨平台保证超出 Node portable API 与 BYZ 非沙箱边界；同字段 helping schedule、claim fsync 和 first-run 语义仍有缺口；保留证据，不创建 attempt 3。

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
- [ ] T-022: [DROPPED] [NEW] 已达到两轮审查上限；当前实现和审查证据只作为 T-023 输入，不得创建 attempt 3
  - 替代: 用户要求处理本轮 P1 后，由重新审批的 T-023 接管；T-022 不构成批准或完成凭证
  - 依赖: T-021
  - 模块: 历史 scope 保持在既有 handoff/review
  - AC: AC-003, AC-004, AC-020
- [ ] T-023: [DROPPED] [NEW][P1] 已达到两轮审查上限；当前实现和审查证据只作为 T-025 输入，不得创建 attempt 3
  - 替代: 经用户明确批准，由 T-025 接管三项剩余边界；T-023 不构成完成凭证
  - 依赖: T-021、Feature 4 T-009
  - 模块: 历史 scope 保持在既有 handoff/review
  - AC: AC-003, AC-004, AC-020, AC-021
- [ ] T-025: [DROPPED] [NEW][P1] 已达到两轮审查上限；当前实现和审查证据只作为 T-026 输入，不得创建 attempt 3
  - 替代: 经用户明确批准，由 T-026 接管三项剩余门禁；T-025 不构成完成凭证
  - 依赖: T-021、Feature 4 T-009
  - 模块: 历史 scope 保持在既有 handoff/review
  - AC: AC-003, AC-004, AC-020, AC-021
- [x] T-026: [NEW][P1] 接管 T-025 attempt 2：使用 TypeScript alias chain 和 canonical source-file/export symbol 身份解析 feature creator，支持 named/namespace/local/re-export alias 并拒绝同名无关模块；拦截 `Reflect.defineProperty` 对 `raw|pi|api|context` 静态 key 的 facade 写入；新增 re-export raw injection、unrelated same-name import 和 reflective defineProperty 正反 fixture，保留 T-025 exact port source、Windows path、Session lineage、Fast reload 与 Prewalk trust 回归 ~45min
  - 依赖: T-021、Feature 4 T-009；接管 T-025 attempt 2 代码但建立独立 attempt/review 链
  - 模块: `packages/byz/scripts/check-architecture.mjs`、`packages/byz/test/architecture.test.mjs`，并回归 T-025/T-023 的 adapter/Fast/Prewalk scope
  - AC: AC-003, AC-004, AC-020, AC-021
- [ ] T-005: [DROPPED][P1] 已达到两轮审查上限；当前实现和审查证据只作为 T-027 输入，不得创建 attempt 3
  - 替代: 根据用户批量授权，由 T-027 接管剩余输出溢出终止门禁；T-005 不构成完成凭证
  - 依赖: T-026
  - AC: AC-006
- [x] T-027: [NEW][P1] 接管 T-005 attempt 2：为 update 输出溢出实现有 deadline 的 SIGTERM→SIGKILL 终止协议，处理 kill false/error、无 close 与后代持管道；补充 stdout/stderr overflow、终止回退及前序成功 step + 后续失败 step 的结果累积回归 ~30min
  - 依赖: T-026；接管 T-005 attempt 2 代码但建立独立 attempt/review 链
  - AC: AC-006

### 对话与开源治理

- [x] T-006: [CHANGED v13][P1] 在 T-026 验证的 Conversation lifecycle/session/model/presentation ports 内，只负责 Conversation controller、progress projector、Presenter、Footer、语言目录和结构化 interaction policy 拆分，保持现有终端行为并移除关键词正文改写；不得重新引入 raw Pi context ~1h
  依赖: T-026
  AC: AC-007, AC-020
- [ ] T-007: [DROPPED][P1] 已达到两轮审查上限；当前实现和审查证据只作为 T-028 输入，不得创建 attempt 3
  - 替代: 根据用户批量授权，由 T-028 使用无持久锁的字段分区原子 cell 接管
  - AC: AC-008
- [ ] T-028: [DROPPED][P1] 已达到两轮审查上限；当前实现和审查证据只作为 T-029 输入，不得创建 attempt 3
  - 替代: 根据用户批量授权，由 T-029 按非权限沙箱威胁边界接管
  - AC: AC-008
- [x] T-029: [NEW][P1] 保留 language/detail 独立原子 cell、descriptor bounded read、strict schema、legacy migration、0700/0600、父目录 fsync、幂等 corrupt copy 与默认诊断；修复 absent-parent 首次启动、claim fsync 和 existing-ancestor chmod，移除会产生 A→B→A 的 live helping，同字段竞争明确失败；仅承诺预存 symlink/non-regular 拒绝和操作期间检测，不宣称阻止任意同用户 Shell 并发替换 ~30min
  - 依赖: T-006；接管 T-028 attempt 2 但建立独立 attempt/review 链
  - AC: AC-008
- [ ] T-008: [DEFERRED] 增加 `UPSTREAM.md`、BYZ `CONTRIBUTING.md`、`SECURITY.md`、NOTICE 和 release provenance，明确代码所有权及人工审查责任 ~30min
  AC: AC-001, AC-002
- [ ] T-009: [DEFERRED] 实现绑定 release commit、仅接受受保护 CI environment/可信签名审批的许可证发布门禁及负向测试；普通仓库 marker 不得通过 ~1h
  依赖: T-008
  AC: AC-012

### 集成与测试

- [x] T-010: [CHANGED v13][P1] 增加 managed-owner 隔离、静态依赖方向、运行时最小 capability facade、跨 Session model handle、canonical-source symbol composition、re-export/namespace creator、Reflect mutation escape、Prewalk trust race、命令结果、Conversation 行为和并发偏好写入回归测试 ~1h
  依赖: T-021, T-026, T-027, T-006, T-029
  AC: AC-003, AC-004, AC-005, AC-006, AC-007, AC-008, AC-020, AC-021
- [x] T-024: [NEW][P1] 运行 P1 focused adapter/architecture/Fast/Prewalk/Execution/Conversation tests、BYZ package、`npm run check` 和仓库外 packed-runtime smoke；确认 Feature 5/6 可在不扩大 raw Pi 边界的前提下新增最小 ports，完成本轮 P1 QA ~1h
  依赖: T-026, T-027, T-006, T-029, T-010
  AC: AC-003, AC-006, AC-007, AC-008, AC-020, AC-021
- [ ] T-011: [DEFERRED][CHANGED v11] 在 P1 QA 和开源治理/许可证任务另行批准后，运行完整 release check、`./test.sh`、BYZ build/package tests，并从仓库外 smoke 最终 tarball 的 CLI、runtime exports、assets、docs/examples 和 workflows ~1h
  依赖: T-008, T-009, T-024
  AC: AC-010, AC-011, AC-012

## 依赖关系

```text
T-001 → T-016 → T-018 → T-020
T-020 → T-021,T-029,T-008
T-021 → T-026
T-026 → T-027,T-006
T-008 → T-009
T-021,T-026,T-027,T-006,T-029 → T-010
T-026,T-027,T-006,T-029,T-010 → T-024
T-008,T-009,T-024 → T-011
```

## 风险点

- Pi 通用 hook 泛化会同时影响 Pi 与 BYZ resource loading，必须保持 owner isolation 和资源 precedence。
- 许可证审批是人工发布门禁；实现只能验证可信审批来源，不能替代法律判断。
- Conversation 重构与 Preference Repository 分开交付，避免 UI 回归和并发存储缺陷互相遮蔽。
- T-002、T-012、T-015、T-013、T-017、T-014、T-019、T-003、T-004、T-022、T-023、T-025、T-005 与 T-007 的两轮审查证据保持不可变；T-016、T-018、T-020、T-021、T-026、T-027、T-006 已通过独立审查。T-028 根据人工批量授权接管 T-007，只能建立全新 handoff 与 N4，不创建旧任务 attempt 3。
- Pi Adapter 不得用透明 Proxy、泛型原样返回或公开 raw handle 假装形成边界；组合根必须按功能裁剪 facade，managed replacement 等高权限只能进入明确声明的 workflow slice。架构门禁必须解析 factory symbol/alias 和所有静态 escape property 形态，不能回退为直接 callee 文本检查。
- ModelIdentity 可跨 reload 保存，ModelHandle 必须绑定当前 Session/adapter lineage；Fast 恢复只能从当前 context 重新解析，不能使用 module-global brand。
- Feature 参数必须绑定当前组合根唯一 `createPiExtensionPorts(pi)` 返回值，不能只检查 `ports.<feature>` 文本；creator origin 必须沿 TypeScript alias/re-export 链绑定 canonical source module 并覆盖 namespace/static element access；raw-write 门禁必须覆盖 `Reflect.set` 与 `Reflect.defineProperty` 静态 key。
- Prewalk 必须在异步 path/tool 校验结束后、handoff 前重验 trust；路径校验开始前的 trust 不能授权之后的副作用。
- T-008、T-009、T-011 与 Feature 2–4 不在本轮 P1 范围，保持 deferred。
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
