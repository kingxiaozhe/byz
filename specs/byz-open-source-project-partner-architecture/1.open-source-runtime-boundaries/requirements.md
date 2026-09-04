# Open Source Runtime Boundaries — 需求规格

## 概述

把完整 BYZ monorepo 整理为可公开协作、可重现构建且与 Pi 上游边界清晰的代码库，并将 BYZ 产品逻辑收敛到稳定适配层和组合根。

## 项目信息

- 项目名: pi-monorepo
- 架构类型: Pi 派生的 npm workspace monorepo
- 上下文范围: full（dependency_or_architecture）
- 优先级: P1（Feature 5/6 的架构前置）
- 执行状态: v16 T-029 及后续必要替代任务已获批量人工授权；本轮只恢复 Feature 1，Feature 2–4 保持 deferred

## 需求版本

| 日期 | 版本 | 说明 |
| --- | --- | --- |
| 2026-08-30 | v1 | 初始需求 |
| 2026-08-30 | v2 | 修订 BYZ 构建输出、并发锁、工作流装配与发布包一致性边界 |
| 2026-08-30 | v3 | 将可超时接管的用户态租约改为 PID + 进程启动身份锁 |
| 2026-08-30 | v4 | 要求进程身份锁在激活后选举、持有校验和发布围栏中同样对 `unknown` 失败关闭 |
| 2026-08-30 | v5 | 补充编译输出的可移植路径冲突校验，并保证 pointer promotion 后的围栏不确定性不会删除 current generation |
| 2026-08-30 | v6 | 要求可移植路径检查覆盖全部祖先组合，并在编译前拒绝源码树 symlink 与非普通文件 |
| 2026-08-30 | v7 | 以 artifact receipt 贯穿 pack、CI smoke 与 publish，并在消费前限制 tar 展开规模和消除 destination 路径竞态 |
| 2026-08-30 | v8 | 将 release dry-run 收敛为 CI 唯一制品生产者，并在锁内完成最终 current/receipt 围栏 |
| 2026-08-31 | v9 | 归档达到审查上限的 managed-resource 任务，补充普通 Pi precedence 兼容和启动期 managed theme 拒绝边界 |
| 2026-08-31 | v10 | 归档达到审查上限的透明 Pi Adapter 任务，要求显式最小能力 facade 和生命周期事件转换 |
| 2026-09-02 | v11 | 归档达到审查上限的 T-022；基于当前 Feature 4 代码新增 T-023，关闭组合别名、跨 Session model reference 和 Prewalk trust check/use 缺口 |
| 2026-09-02 | v12 | 归档达到审查上限的 T-023；新增 T-025 绑定真实 port source、解析 namespace creator 并拒绝 Reflect.set raw escape |
| 2026-09-02 | v13 | 归档达到审查上限的 T-025；新增 T-026 精确解析 creator source/re-export 并拒绝 Reflect.defineProperty |
| 2026-09-02 | v14 | 归档达到审查上限的 T-005；新增 T-027 以有界终止协议关闭 update 输出溢出挂起 |
| 2026-09-03 | v15 | 归档达到审查上限的 T-007；新增 T-028 字段分区原子偏好 cell |
| 2026-09-03 | v16 | 归档达到审查上限的 T-028；新增 T-029 并恢复 BYZ 非权限沙箱威胁边界 |

## v11 P1 执行范围

- 本轮恢复：F-003、F-005、F-006 与 AC-003、AC-006、AC-007、AC-008、AC-020、AC-021，包括最小 capability facade、Command Registry、Conversation 拆分、并发偏好存储及其最终 QA。
- 已完成的构建、managed-resource 和 artifact receipt 合同保持不动，只做回归。
- F-001、F-002、F-008、AC-001、AC-002、AC-012 的开源治理/许可证发布门禁保持 deferred，不属于用户本次列出的 P1；Feature 2–4 也不得顺带执行。

## 用户故事

- 作为 BYZ 维护者，我想让 Pi 升级影响集中在适配层，以便持续保留上游历史并降低合并冲突。
- 作为社区贡献者，我想清楚识别 Pi 上游、BYZ Core、工作流和生成产物，以便把改动提交到正确边界。
- 作为发布维护者，我想从干净 clone 重现 BYZ 包，以便公开发布可审计。
- 作为终端用户，我想保持现有 Fast、Prewalk、工作流切换、对话壳和诊断行为，以便架构调整不破坏既有使用方式。

## 功能需求

1. [F-001] 仓库必须保留 Pi 上游 Git 历史，并说明 upstream/main 同步与 merge 规则。
2. [F-002] 仓库必须明确 Pi 上游、BYZ 通用扩展、BYZ 产品层、Bundled Workflow 和生成产物的所有权边界。
3. [F-003] BYZ 必须通过统一 Pi Adapter 提供的显式最小能力 facade 使用 runtime、session、resource、model 和 UI 能力；Adapter 必须把 Pi 生命周期事件与命令上下文转换为产品无关 ports，不得以透明 Proxy、泛型原样返回或其他方式把完整 Pi Extension API 交给 BYZ 功能模块；新的 Domain/Application 模块不得导入 Pi 内部上下文。Model reference 必须绑定创建它的当前 live Session/adapter lineage，reload 恢复必须通过当前 context 重新解析安全 identity，不能用 module-global brand 接受另一 Session 的引用。异步 trust/path 校验必须在最终副作用前再次检查 trust。架构门禁必须沿 TypeScript alias/re-export 链把 feature creator 绑定到 canonical source file 与原始 export symbol，支持 named/namespace/static element/local/re-export alias 且不得把无关同名 import 当作 feature；computed/accessor、`Reflect.set` 和 `Reflect.defineProperty` raw escape 必须失败。每个 feature 参数必须解析到当前组合根中唯一、不可重赋值且由 `createPiExtensionPorts(pi)` 初始化的 port bundle，不能只匹配局部名称或属性文本。`[v13 修改: 关闭 T-025 round 2 的三项剩余门禁]`
4. [F-004] Pi Core 中现有 BYZ 专属 managed-resource 和 UI 分支必须泛化为产品无关能力，并由 BYZ 组合根配置；普通 Pi 未显式配置时必须保持既有 resource precedence，BYZ 所需的 `before` precedence 只能通过产品无关配置声明；managed owner 在启动发现和运行期都只能管理 skills/prompts，非空 theme 更新必须在任何资源状态变化前明确失败。`[v9 修改: 防止 precedence 全局泄漏并关闭启动期 theme 静默丢弃]`
5. [F-005] BYZ 自有 CLI 命令必须通过 Command Registry 解析和执行，业务命令返回结构化结果而不是直接控制全局退出状态；update 子进程输出必须有界捕获，溢出后以有 deadline 的 TERM→KILL 协议终止，kill 失败或无 close 也必须在固定时间内返回失败结果。`[v14 修改]`
6. [F-006] Conversation Extension 必须拆分为生命周期绑定、控制器、Presenter、进度投影、Footer、语言目录和偏好存储；用户可观察行为保持不变。偏好存储以 language/detail 独立原子 cell 消除跨字段覆盖，不使用可残留的共享持久锁。`[v15 修改]`
7. [F-007] BYZ 构建必须编译或复制完整源码入口图，禁止依赖手工逐文件维护复制清单；干净 checkout 构建后，workspace 的 `bin`、`main`、`types` 和 exports 必须解析到本次构建产物。`[v2 修改: 补充源码 workspace 入口一致性]`
8. [F-008] 公开仓库必须提供 BYZ 专用的贡献、安全、上游来源和第三方许可证说明；人工许可证审查是公开发布硬门禁。
9. [F-009] 构建输出根必须固定在 `packages/byz` 安全边界内并拒绝 symlink 逃逸；并发构建锁必须绑定 owner token、PID 与可核验的进程启动身份，只能在确认原 owner 已终止或 PID 已被其他进程复用后恢复，暂停但仍存活的 owner 不得被超时接管；锁获取、激活后选举、持有校验和发布围栏只要观察到其他完整 owner 的进程身份为 `unknown` 就必须失败关闭；workflow bundle 目标，以及 BYZ 编译输出、package metadata 与保留 Pi runtime/assets 目标之间的冲突，都必须按同一可移植文件系统语义对全部候选组合判定，不能只比较排序后的相邻项；BYZ `src`、runtime、docs/examples、metadata、workflow 和最终 image 都必须在读取或复制前后拒绝 symlink 与非普通文件，防止编译器把 package 边界外内容转化为普通产物；pointer promotion 已发生后，即使后置围栏无法确认 ownership，清理也不得删除 current 指向或无法排除正被 current 指向的 generation。`[v6 修改: 增加全量祖先冲突与源码 provenance 校验]`
10. [F-010] release dry-run 必须是 CI 发布链中唯一的制品生产者，并在持有进程身份构建锁期间从 current image 生成一个不可变 tarball 及其 content-bound artifact receipt；CI 不得随后再次 pack，外部 smoke 和最终 publish 必须直接消费 dry-run 返回的同一制品字节。流程不得回退打包源码 package root、陈旧生成目录或仅凭可变 tarball pathname 传递制品；pack 必须自行创建输出根外的私有制品目录，CI 与 publish 在任何解压、安装或执行前验证 generation identity、SHA-256、文件清单及展开大小上限。`[v8 修改: 单一制品生产者与锁内最终围栏]`

## 非功能需求

- 安全: 不削弱现有项目 trust、symlink 路径边界、诊断隐私和凭证处理；构建锁与输出清理不得作用于 package 边界外路径。
- 兼容性: 保持现有 `byz` CLI、npm 包入口及 0.1.11 已公开命令行为；源码 workspace 与安装后的 tarball 使用相同公开入口语义；内部 BYZ 专属 Pi hook 不承诺兼容。
- 可维护性: 新 BYZ 架构代码使用 erasable TypeScript syntax；Domain/Application 不依赖 Pi。
- 可重现性: 干净 clone 使用仓库公开命令生成与发布流程一致的 tarball。
- 性能: 架构层不得为每轮 Agent 执行增加额外进程或同步全仓扫描。

## 验收标准

- [ ] [AC-001] `UPSTREAM.md` 能说明上游 remote、同步方式、必须保留 merge commit 的场景及 BYZ 修改归属。
- [ ] [AC-002] BYZ 贡献指南能让贡献者判断一个改动应进入 Pi 通用层、BYZ Core 还是扩展层。
- [x] [AC-003] 依赖检查能阻止 BYZ Domain/Application 导入 Pi runtime、TUI、SQLite 或 Node 文件系统实现。
- [x] [AC-004] Pi Core 不再出现 `byzWorkflowExtensionFactory`、`replaceByzWorkflowResources` 和硬编码 `<inline:byz-workflow>` 等产品专属公共契约。
- [x] [AC-005] managed resource owner 只能更新自己拥有的 skills/prompts，其他扩展无法取得该能力；多个 owner 的替换、空资源替换、project-trust preload 和 reload 不得删除其他 owner 或使合法 token 失效。`[v9 修改]`
- [x] [AC-006] `byz update`、`workflow`、`diagnostics` 等 BYZ 命令返回统一 `CommandResult`，CLI 入口统一映射 stdout、stderr 和退出码；update stdout/stderr 溢出、TERM/KILL 失败或无 close 时必须有界失败并保留前序 step 的结构化输出证据。`[v14 修改]`
- [x] [AC-007] Conversation 拆分后欢迎语、紧凑/详细模式、语言偏好、Footer、确认等待和阶段计时回归测试继续通过。
- [x] [AC-008] Conversation 偏好损坏时保留默认可见诊断；写入使用当前用户私有权限，并以 language/detail 独立版本化原子 cell 保证两个 BYZ 进程分别保存语言和详情模式时互不覆盖；同字段竞争必须串行成功或明确失败。descriptor 读取拒绝预存 symlink、non-regular 与 oversize，并检测操作期间可观察的 identity 变化；BYZ 不宣称在无权限隔离时阻止同用户恶意 Shell 在任意两次系统调用间替换 pathname。`[v16 修改]`
- [ ] [AC-009] 在隔离 workspace 的真实 BYZ 生产构建链中新增嵌套源模块，无需修改逐文件复制数组即可进入 package image；构建完成后源码 workspace 的 `byz` bin、main、types 和 exports 全部解析到 current generation。`[v2 修改]`
- [ ] [AC-010] 干净 clone 可运行安装、BYZ build、check、非 E2E 测试和 pack smoke；首次构建、并发构建和中断恢复都不暴露缺失、陈旧或混合的公开入口。
- [ ] [AC-011] npm 包继续包含所需 Pi runtime assets、文档、示例和锁定工作流，且公开包检查通过。
- [ ] [AC-012] 未取得绑定当前 release commit、来自受保护 CI environment 或等价可信审批源的人工许可证审查凭证时，公开发布失败；仓库内普通 marker 不能单独满足门禁，本地开发与测试不被阻断。
- [ ] [AC-013] `.byz-output` 为 symlink，或 workflow 目标在大小写、Unicode 规范化、尾随点/空格及祖先关系下发生别名时，构建必须在写入前拒绝；owner 进程仍存活但暂停时第二个构建必须失败，owner 已终止或同 PID 的启动身份不匹配时锁可恢复，且旧 owner 不能发布 generation 或释放新 owner 的锁；并发 claimant 激活后，只要任一 ownership 决策无法确认其他完整 owner 为 `same | absent | different`，相关锁获取或发布就必须失败，不能返回两个可发布的 lock handle。`[v4 修改]`
- [x] [AC-014] CI 只能调用一次 release dry-run 来生成 tarball 与 receipt，并把该调用返回的私有 canonical artifact/receipt 路径直接传给仓库外 smoke 和 publish；不得在 dry-run 后再次调用独立 pack。dry-run、smoke 和 publish 前身份校验必须解析到同一 current generation，并通过同一 artifact receipt 绑定制品 SHA-256；pack 只能让 npm 写入其自行创建、位于 `.byz-output` 外的私有真实目录，不能把调用方可变 destination pathname 直接交给 npm；destination symlink 重定向或源码根存在陈旧产物时，也不能改为打包其他目录或修改 current image。`[v8 修改]`
- [ ] [AC-015] BYZ 编译输出、package metadata 与保留的 Pi `dist/runtime/**` 或 runtime asset 目标在大小写、Unicode 规范化、尾随点/空格等可移植文件系统语义下构成别名时，构建必须在复制或覆盖前拒绝；冲突检测必须覆盖任意两项及全部文件/目录祖先关系，`A.js`、`a.js-foo.js`、`a.js/b.js` 等非相邻排序反例不能通过；若 `current` pointer 已原子切换而后置 publication fence 随即失败或返回 `unknown`，构建必须显式保留“已 promotion、确认不完整”的结果，且失败清理只能删除已证明未被 current 指向的 generation，任何情况下 `current` 都不能因此悬空。`[v6 修改]`
- [ ] [AC-016] 编译器运行前必须以 no-follow 方式递归验证 BYZ `src` 为真实目录和普通文件组成的 package 内源码树；预先存在的源码 symlink、junction 或其他非普通条目必须在编译前失败，不能跟随外部 JavaScript/TypeScript 并把其内容变成可发布的普通产物；复制源和最终 package image 的同类验证继续成立。`[v6 新增]`
- [x] [AC-017] pack 生成的 artifact receipt 必须至少记录 current generation identity、package name/version、tarball SHA-256、精确文件路径/类型/单文件展开大小和总展开大小；CI smoke 前后及 publish 捕获私有快照后都必须重新验证 receipt 与实际字节一致，任何 pathname 替换都失败；tar consumer 在首次解压、安装或执行前必须以流式 header 检查拒绝重复/越界路径、link、特殊条目、清单或大小不匹配，以及超出显式文件数、单文件和总展开上限的压缩包，不能先完整解压或 `readFile` 后再发现超限。`[v7 新增]`
- [x] [AC-018] release dry-run 必须从开始校验 current、执行 npm pack、生成并验证 receipt，直到最终重新确认 current pointer、generation identity、receipt 与锁 ownership 全程持有同一个进程身份构建锁；若 pack 边界内 current 被切换、ownership 丢失或最终围栏无法确认，dry-run 必须失败且不得把候选路径交给 smoke/publish。`[v8 新增]`
- [x] [AC-019] 未配置产品 profile 或 managed owner 的普通 Pi session 中，auto-discovered 与 additional skills/prompts 的同名冲突顺序必须保持 v9 前既有行为；BYZ 静态与动态 workflow 的高优先级只能由产品无关的显式 precedence 配置产生。managed extension 在 startup/reload discovery 返回非空 `themePaths` 时必须在应用 skills/prompts、重建 system prompt 或发送 `resources_changed` 前明确失败，不能静默删除 theme 或留下部分资源状态。`[v9 新增]`
- [x] [AC-020] BYZ 组合根必须只向 diagnostics、workflow、Fast、Prewalk、Conversation、Execution 及后续批准的 Pause/Delivery 注入各自声明的产品无关 ports；这些 facade 不得包含未声明的 Pi capability 或保留指向完整 Pi Extension API 的公开逃逸口。Pi 生命周期事件、command context、model/session/resource/UI 操作必须在 Adapter 内转换后再交给功能模块，功能模块尝试访问未声明能力时应得到能力不存在或明确拒绝，而不是继续调用 Pi。`[v11 修改]`
- [x] [AC-021] 符号解析架构 fixture 中，feature factory 经局部/container/namespace/re-export alias 或 static element access 调用、伪造或重赋值的同名 port bundle、computed `globalThis["Proxy"]`、accessor/raw context 属性、`Reflect.set`/`Reflect.defineProperty` 静态 raw key 或额外 raw Pi 注入均必须失败；只有 creator 解析到 canonical feature source 且参数绑定当前组合根唯一 `createPiExtensionPorts(pi)` source 的合法 composition 通过，无关模块的同名 creator 不得误报。Session A 的 model reference 不能由 Session B 接受，A 在同一 Session reload 后必须通过 B 当前 context 重新解析并恢复；Prewalk 在异步 realpath 期间撤销 trust 后不得应用 Fast handoff。`[v13 修改]`

## 依赖

- 现有 Pi extension/resource loader 能力。
- `packages/byz/upstream.json`、`workflows.lock.json` 和 BYZ release scripts。
- 人工许可证与版权审查。
- 已合并的 Feature 4 execution facade 是 v13 rebaseline 输入；Feature 5 PausePort 和 Feature 6 DeliveryPort 只能在 T-026 完成后扩展该边界。

## 开放问题

- 无阻塞产品问题。人工许可证审查保留为发布门禁，不由规格阶段代替。
