# Open Source Runtime Boundaries — 技术设计

## 设计版本

| 日期 | 版本 | 说明 |
| --- | --- | --- |
| 2026-08-30 | v1 | 初始设计 |
| 2026-08-30 | v2 | 处理 T-002 第二轮审查暴露的输出逃逸、workspace 入口、锁租约、workflow 重叠和打包分叉 |
| 2026-08-30 | v3 | 取消活进程超时接管，改用 PID + 进程启动身份锁 |
| 2026-08-30 | v4 | 采用不可移动 owner 记录，并把 competing `unknown` 的失败关闭扩展到激活后选举与发布围栏 |
| 2026-08-30 | v5 | 为编译输出与保留 runtime 目标统一可移植路径命名空间，并使 generation 清理感知 pointer promotion 结果 |
| 2026-08-30 | v6 | 用完整祖先判定替换相邻项假设，并在编译前建立 BYZ 源码 provenance 边界 |
| 2026-08-30 | v7 | 让私有制品目录、artifact receipt 和有界 tar header 校验贯穿 pack、smoke 与 publish |
| 2026-08-30 | v8 | 让 release dry-run 成为 CI 唯一制品生产者，并在进程身份锁内完成最终制品围栏 |
| 2026-08-31 | v9 | 收紧 managed-resource 生命周期：普通 Pi 保持既有 precedence，BYZ 显式声明覆盖顺序，启动期 managed theme 失败关闭 |
| 2026-08-31 | v10 | 将透明 Pi API 代理改为显式最小能力 facade，并要求 Adapter 转换生命周期事件与命令上下文 |
| 2026-09-02 | v11 | 以 T-023 接管 T-022 当前代码，关闭符号别名、跨 Session model reference 与异步 Prewalk trust 漂移 |
| 2026-09-02 | v12 | 以 T-025 接管 T-023 当前代码，补齐真实 port source binding、namespace creator resolution 与 Reflect.set raw-write 检查 |
| 2026-09-02 | v13 | 以 T-026 接管 T-025 当前代码，绑定 canonical creator source/re-export chain 并补齐 Reflect.defineProperty |
| 2026-09-02 | v14 | 以 T-027 接管 T-005 当前代码，为 update 输出溢出增加有界 TERM→KILL 终止协议 |
| 2026-09-03 | v15 | 以 T-028 接管 T-007，采用字段分区原子 cell 替代共享持久锁 |
| 2026-09-03 | v16 | 以 T-029 接管 T-028，收口首次启动与 claim 语义并明确非权限沙箱边界 |

## 项目架构

- 架构类型: npm workspace monorepo；`packages/byz` 打包选定 Pi runtime 与工作流。
- 涉及层: BYZ CLI/构建/展示、Pi extension/resource loader、仓库治理与发布检查。
- 设计基准: 无 UI 视觉基准；现有 TUI 行为与测试为交互基准。

## 设计目标

建立一个单向依赖边界：

```text
BYZ bootstrap → application/ports ← adapters/pi
             → presentation/tui
             → existing features

Pi runtime 不依赖 BYZ 产品概念
```

本 feature 不引入 Project 数据模型；只提供后续 feature 可依赖的结构和适配接口。

## 功能模块设计

### 模块 1：开源所有权与发布门禁

新增 `UPSTREAM.md`、`SECURITY.md`、第三方 NOTICE 和 BYZ 专用贡献说明。保留根 MIT 上游声明，不删除上游版权；BYZ 版权和 bundled workflow 来源通过人工审查后追加。

公开包检查读取结构化 release-provenance manifest，验证 Pi commit/version、BYZ version、workflow lock 和许可证文件。manifest 只承担来源记录，不能证明人工审查。许可证审批必须绑定待发布 commit，并来自受保护 CI environment、可信 reviewer 签名或等价的仓库外授权边界；普通贡献者可修改的 marker 不能满足发布门禁。

### 模块 2：TypeScript 构建、generation 与发布包边界 `[v2 修改]`

为 `packages/byz` 增加 build tsconfig。新架构模块使用 erasable TypeScript syntax，由 tsgo 编译完整 `src/**/*`；现有 JavaScript 可渐进迁移，但构建脚本不再逐个列出 `cli.js`、`fast.js` 等源码文件。生产构建编排提取为可注入根路径的函数，CLI 只提供仓库默认路径，使测试能在隔离 workspace 调用同一编排、同一 build manifest 和同一 tsconfig，而不是另写一个只验证测试假设的编译 fixture。

编译器运行前先对 manifest 指定的 BYZ `src` 根做 no-follow 递归遍历：根和每个祖先必须是 package 内真实目录，叶子必须是普通文件；symlink、junction、socket、device 等非普通条目立即失败。该检查发生在编译器读取源码之前，防止 TypeScript 跟随外部 `.js/.ts` 后把来源信息洗成普通编译产物；检查与编译之间的同用户恶意并发替换仍按既定威胁模型处理。

编译器只读取通过验证的源码树，并先写入 generation 内独立 staging tree，不直接写最终 `dist`。复制前枚举全部编译输出、package metadata、生成根和保留的 Pi `dist/runtime/**`、runtime asset 目标，为各路径生成同一个可移植 package-path key：统一 POSIX separator、逐 segment 做确定性的 Unicode 规范化与大小写折叠，并处理尾随点/空格和 Windows 保留名；无法安全 canonicalize 的路径保守拒绝。重复和文件/目录祖先冲突使用 segment trie，或将每个 key 的全部祖先 prefix 放入集合查询；不得依赖“排序后冲突项必相邻”。`A.js`、`a.js-foo.js`、`a.js/b.js` 必须识别为 `A.js` 与 `a.js/b.js` 冲突。所有命名空间检查在复制前完成，禁止依赖宿主文件系统是否区分大小写，也禁止 metadata/runtime asset 静默覆盖 BYZ 编译产物。

`packages/byz/.byz-output` 是唯一 generation 输出根。开始构建前必须以 no-follow 方式确认它不存在或是 `packages/byz` 内真实目录；自身为 symlink、其 realpath 越出 package，或关键后代是非预期 symlink 时立即失败，不进行递归清理。每次构建写入新的不可变 `generations/<id>/package`，完整校验后仅原子切换一个 `current` pointer。失败 generation 只有在重新检查 pointer 后证明未被 `current` 指向时才可清理；pointer 状态无法读取、无法 canonicalize 或不能排除指向该 generation 时必须保留。current generation 和源码 package 的现有公开入口始终可用。

源码 workspace 与发布 package 使用两份用途明确的 package metadata：

- 仓库中的 `packages/byz/package.json` 的 `bin`、`main`、`types` 和 exports 指向 `.byz-output/current/dist/**`，因此干净 checkout 完成 build 后 npm workspace symlink 解析到本次 generation；
- package image 中生成并校验发布 metadata，公开入口指向 image 内真实 `dist/**`，不得包含 `.byz-output` 路径；
- 发布 metadata 只能由受测的确定性转换生成，版本、依赖、files、license 和公开 export 集合必须与源码 metadata 一致。

Pi runtime、runtime assets、docs/examples 和 workflows 仍从锁定来源装配。Workflow destination 先统一为 POSIX 相对路径，再整体校验：必须位于 `workflows/<name>` 后代，拒绝 `workflows` 根、重复目标以及任意祖先/后代重叠；校验通过后才允许并行复制。来源 realpath 仍必须落在解析出的锁定 package 内。

构建锁改为进程生命周期锁，不再按时间过期接管。锁记录包含随机 owner token、PID 和不可由 PID 单独替代的进程启动身份 `processStartId`。平台 probe 返回 `same | absent | different | unknown`：Linux 使用 `/proc/<pid>/stat` 的启动 tick，macOS 使用固定 locale/时区的系统 `ps` 启动身份，Windows 使用系统进程启动时间查询。`unknown` 不是可恢复状态；首次竞争检查、claim 激活后的最终选举、持有期间的 `assertOwner` 和 publication fence 都必须对其他完整 owner 的 `unknown` 结果失败关闭。

每个 claimant 先在候选目录写完整 owner metadata，再原子安装到以 owner token 命名的不可移动目录。竞争者不得移动或删除其他完整 owner 目录；释放只能删除与自身 token 绑定的目录。锁安装中断留下的不完整候选不参与选举。已证明为 `absent` 或 `different` 的旧 owner 不再阻塞恢复，但清理它也不能成为新 owner 获胜的前提。

选举分为 claiming 和 active 两阶段。同一轮可见的 `same` claimant 使用稳定全序选出候选 winner；候选通过排他创建 active marker 激活，再重新扫描全部完整 owner。active owner 使用存储层激活顺序和 owner token 打破平局。只有最终扫描证明当前 owner 是唯一 winner，且不存在其他 `same` active owner 或任何 `unknown` owner 时，才能向调用方返回 lock handle。任一竞争状态不确定都返回失败，不允许依赖事件循环让步来假定所有 claimant 已经可见。

锁 handle 的每次持有校验和发布都重新核验 owner token、PID、`processStartId`、输出根/lock root/generations root inode 与最终选举约束；锁持续持有到 `current` pointer 原子切换完成。因为活 owner 永不被接管，且不确定 owner 会阻止发布，暂停在 pointer promotion 中间的进程仍是唯一发布者，不存在旧进程恢复覆盖新 generation 或两个 handle 同时发布的执行轨迹。

publication API 必须把 pointer 是否已完成原子 rename 作为不可丢失的状态：至少区分 `not-promoted`、`promoted-confirmed` 和 `promoted-unconfirmed`。后置 ownership fence 在 rename 后失败或观察到 `unknown` 时，调用方仍收到可机械识别的 `promoted-unconfirmed`，构建整体可以失败，但不得把该 generation 当作 unpublished 删除。构建 `finally` 清理同时以 publication state 和重新解析的 `current` identity 为双重围栏；只有明确 `not-promoted` 且 `current` 已证明不指向候选 generation 时才递归删除。无法确认时保留完整 generation，由后续受锁保护的维护流程处理，而不是冒险制造 dangling pointer。

release dry-run 是 CI 发布链唯一允许调用 image pack 边界的制品生产者。它先取得与生产 build 相同的进程身份锁，再解析 current 到不可变 generation、重新校验 image 与发布 metadata，并把该 realpath 作为 `npm pack` 的唯一 package positional input。CI 不得在 dry-run 返回后再次调用 `pack.mjs` 或任何等价 pack helper；禁止任何路径回退到源码 package root。

pack 不再把调用方提供的 destination pathname直接交给 npm。它在 `.byz-output` 外的受控临时基目录中以 `mkdtemp` 原子创建 mode `0700` 的不可预测私有目录，确认目录为真实目录后，将这个新建目录的 canonical path 作为唯一 `--pack-destination`。调用方最多选择受信任的基目录；最终制品目录、文件名和生命周期由 pack 拥有，不能通过 destination symlink 在检查与使用之间重定向到 current image。

pack 完成后生成结构化 artifact receipt。receipt 至少包含 schema version、current generation identity、image metadata digest、package name/version、tarball SHA-256、npm integrity、文件数量，以及每个 tar entry 的 portable path、regular-file 类型、mode、展开大小和总展开大小。receipt 与 tarball 写入私有目录，权限为 `0600`；任何消费者不得只信 pathname 或 package name/version。

提供统一的 artifact verifier。它先以 no-follow 打开 receipt 和 tarball，把 tarball 捕获到自己新建的私有快照并校验 SHA-256；随后使用流式 tar header parser 在任何解压、安装、执行或整文件 `readFile` 前检查：entry path 与 receipt 精确匹配且唯一、只允许目录和普通文件、拒绝 link/device/sparse 等特殊类型、逐文件大小与 receipt 一致、文件数量/单文件/总展开大小不超过 receipt 与代码硬上限。若采用外部 parser，必须作为精确固定版本依赖并审查其 lifecycle 与锁文件；不能用先完整解压再检查的实现。

release dry-run 在同一锁 handle 下执行 npm pack、生成 receipt、重新验证 tarball 与 receipt，并在返回前再次断言 ownership、current pointer 和 generation identity。只有全部最终围栏成功时，它才以机器可读结果返回 pack 自有私有目录中的 tarball path、receipt path、generation identity 和 SHA-256；锁丢失、current 切换或无法确认时删除已证明未交付的私有候选并失败，不向后续步骤暴露可消费路径。

CI artifact step 只调用一次该 release dry-run，并把它返回的同一 tarball/receipt 直接传给仓库外 smoke 和 publish。仓库外 smoke 前 verifier 生成仅本步骤可读的私有快照，smoke 只解压、安装和执行该快照；smoke 后再次核对 SHA-256。publish 重新取得进程身份锁，独立 no-follow 捕获 dry-run 原始制品，验证同一 receipt、同一 SHA-256 和仍为 current 的 generation identity，并只把验证后的私有快照传给 `npm publish`。smoke 与 publish 可以使用不同私有 snapshot pathname，但必须由 dry-run 的同一 receipt 证明字节完全相同；任一阶段 pathname 被替换、receipt 不匹配或 current 已切换都失败关闭。

### 模块 3：BYZ 组合根与 Command Registry

`bootstrap` 负责：

1. 解析一次 BYZ-owned options/commands；
2. 构造 diagnostics、workflow、Fast、Prewalk、conversation 与 Pi adapter；
3. 决定是否启动 Pi runtime；
4. 将 `CommandResult` 统一映射到输出和退出码。

```ts
interface CommandResult {
	status: "handled" | "passthrough";
	exitCode: number;
	stdout: string[];
	stderr: string[];
}

interface ByzCommand {
	id: string;
	parse(args: readonly string[]): unknown;
	execute(input: unknown, context: CommandContext): Promise<CommandResult>;
	runtime: "none" | "pi" | "interactive";
}
```

Command 实现不得直接写 `process.exitCode`。Pi passthrough 只接收未被 BYZ 消费的参数，并保留 `--` 语义。

update 子进程的 stdout/stderr 进入固定字节上限的 collector，不得继承终端输出。任一 stream 溢出后立即封存已接受内容并启动有界终止状态机：发送 SIGTERM，短 deadline 后仍未 close 则发送 SIGKILL，再以最终 deadline 保证 Promise settle；`kill()` 返回 false、抛错、`error`/`close` 乱序或后代持有 pipe 都不能制造无界等待。结果保留已完成 step 的输出和当前失败原因，只有 CLI 统一发布。

### 模块 4：Pi Adapter 与通用 managed resources

将 BYZ 直接使用的 Pi 接口集中到 `adapters/pi`。Adapter 是唯一可以持有完整 Pi Extension API 的位置；它必须构造普通对象形式的显式 ports，不得用透明 `Proxy`、泛型原样返回或公开 `raw/context/api` 等逃逸属性。组合根可以在内部持有完整 port bundle，但向 diagnostics、workflow、Fast、Prewalk 和 Conversation 注入时必须按各功能声明的接口选取最小 capability slice。

Adapter 负责把 Pi 生命周期事件转换为产品无关的判别联合事件，把 Pi command handler context 转换为只含该命令所需 session/model/resource/UI 能力的 BYZ context。功能模块只接收 ports 和产品事件，不注册或读取原始 Pi context。未声明属性在 facade 上不存在；managed resource 替换能力只进入 managed workflow 的 command context，不能因其他功能需要通知或 session 状态而一并泄漏。

迁移按以下边界执行：

- diagnostics 只接收 runtime event、model metadata 和 recorder 所需能力；
- workflow 只接收 resource discovery、command registration、idle/UI 和 owner-bound managed replacement；
- Fast 只接收 command/event、model registry/model selection、thinking、idle 和 UI；
- Prewalk 只接收 command/tool-result、tool catalog、trust/cwd/idle 和 UI；
- Conversation 只接收其生命周期、session projection、model/thinking 和 presentation UI ports；后续分层任务继续在该 port 边界内拆 controller 与 Presenter；
- `productProfile` 继续由 runtime launch adapter 注入，普通 Pi 默认值保持不变。

架构检查同时验证静态依赖方向和组合根装配：Domain/Application 只能导入 domain/ports；BYZ 功能 factory 不得接受完整 Pi Extension API；回归 fixture 必须证明 facade 没有未声明 Pi capability，并证明 event/command context 转换仍能驱动现有行为。

`[v13 修改]` T-026 接管 T-025 已成立的 Session lineage、Fast reload、Prewalk trust、exact port source、namespace alias、Windows path 与 raw-write 防线，并补充以下最终边界：

- 把模型的可持久 identity 与可执行 handle 分开。Fast controller 只保存 bounded `{provider,id}` identity；每次 restore 都通过当前 command/event context 的 registry 取得当前 Session-lineage handle，再交给同一 port 的 `setModel`。Adapter projector/brand 只存在于一次 `createPiExtensionPorts` lineage 内，不使用 module-global WeakMap，也不接受旧 lineage 或另一 live Session 的 handle。
- Architecture gate 使用 TypeScript Program/type-checker 沿 alias 与 re-export 链解析 feature creator 的原始 export symbol，并把其 declaration source file 与每个 feature 的 canonical module allowlist 对比；named import、局部/container alias、namespace property、static element 和 re-export alias 使用同一 provenance，其他模块的同名 export 不分类。所有 factory 调用只允许在 composition root，参数必须解析到当前 scope 唯一、不可重赋值且 initializer 是 canonical `createPiExtensionPorts(pi)` 的 port-bundle symbol；shadow、reassignment 或伪造同名对象全部拒绝。Adapter AST 同时拒绝 direct/computed Proxy、property/method/get/set accessor、静态 computed key、direct assignment、`Object.defineProperty`、`Reflect.set` 与 `Reflect.defineProperty` 中的 `raw|pi|api|context` 逃逸。
- Prewalk 在 awaited realpath 返回后重新读取 project trust 和 built-in tool identity，并在消费 armed target、调用 Fast handoff前最后检查一次；trust 在路径校验期间撤销时保持 armed target 不被应用并安全取消。
- Execution 继续使用已合并的专用 closed port。后续 Pause/Delivery 只能通过新增显式最小 port 接入，不得重新扩张 Conversation 或通用 raw context。

Pi Core 的产品专属名称改为通用 managed extension 能力：

- managed factory 由不可伪造的内部 owner token 标识，不由显示名称授权；
- owner 只能替换自己登记的 prompt/skill roots；多个 owner 各自保存 snapshot，替换一个 owner 后按稳定注册顺序重建 `before owners → unmanaged baseline → after owners`，不得覆盖其他 owner；
- managed owner precedence 由 owner 配置，不依赖 `APP_NAME === "byz"`；
- 静态 additional skills/prompts 使用产品无关的 `additionalResourcePrecedence: "before" | "after"`（或等价内部配置），默认值必须保留普通 Pi 在 v9 前的 auto-discovered/additional 冲突顺序；BYZ 组合根只为需要覆盖宿主同名资源的静态 workflow 显式选择 `before`；
- managed extension 的 startup/reload discovery 与命令替换都只允许 prompt/skill roots；任一 managed owner 返回非空 `themePaths` 时，在 loader 状态、system prompt 和 `resources_changed` 发生变化前抛出明确错误，禁止静默过滤或部分应用；
- owner metadata 即使没有 `resources_discover` handler 也必须完成 capability 注册；project-trust preload/reload 重新加载 extension 时 token 与 owner 注册必须同步刷新；
- UI 启动展示由 `productProfile` 配置，不读取 `BYZ_CODING_AGENT` 分支；
- capability 不暴露给普通 ExtensionCommandContext，伪造、陈旧和 owner 不匹配的 token 均失败。

BYZ 组合根注册 managed owner 并通过 Adapter 使用；普通 Pi 默认配置保持既有 precedence。同一提交同步迁移现有调用方，不保留 BYZ 命名兼容层。

### 模块 5：Conversation 分层

拆分为：

```text
conversation-extension.ts       Pi 生命周期装配
conversation-controller.ts      每轮状态协调
progress-projector.ts           tool/runtime 事件 → 进度投影
confirmation-presenter.ts       决策输入
footer-presenter.ts             Footer 渲染
language-catalog.ts             中英文文案
conversation-preferences.ts     偏好 repository
interaction-policy.ts           结构化展示策略
turn-timing.ts                  单调计时
```

不再通过替换 `model/tool/workflow` 单词修改普通技术正文。Presenter 根据结构化 message category 决定隐藏进度、工具和高级控制。

Conversation preferences 使用字段分区原子 JSON cell：`language` 与 `detailMode` 各自拥有完整 schema、revision 和独立 destination，分别通过同目录 mode-0600 临时文件、fsync、rename 与父目录 fsync 发布。两个进程修改不同字段时没有共同可覆盖 pathname，因此不需要可能在崩溃后残留的共享锁。同字段 next-revision claim 在发布前 fsync directory；若 live claim 已存在，竞争调用明确返回 busy，不帮助并覆盖活 writer。首次创建每一级 managed 子目录时 fsync 已打开的原 parent，且不得 chmod 已存在的非 managed ancestor。读取使用 no-follow descriptor、前后 file identity 与 maximum+1 字节上限；预存 symlink/non-regular/oversize 或可观察 identity 变化失败关闭。损坏 cell 从已打开 descriptor 的有界字节写入一个幂等 forensic slot，不 rename 当前 pathname。旧 `conversation.json` 只作为只读迁移 baseline；任一 cell 存在后对应字段以 cell 为准。同步读取只允许发生在 session 初始化，不进入高频事件路径；写入路径使用异步 descriptor I/O。默认组合根展示固定 corrupt/unavailable 诊断。由于 BYZ 不是权限沙箱，跨平台实现不承诺阻止任意同用户 Shell 在两次系统调用之间替换并恢复 pathname；需要该保证时必须在外部 sandbox/container 中运行。

## 接口契约

### BYZ runtime ports

```ts
interface RuntimePort {
	on(event: ByzRuntimeEventName, handler: (event: ByzRuntimeEvent) => void | Promise<void>): Disposable;
}

interface SessionPort {
	isIdle(): boolean;
	isProjectTrusted(): boolean;
	getCwd(): string;
	getSessionProjection(): SessionProjection;
}

interface ModelPort {
	getCurrent(): ModelReference | undefined;
	find(provider: string, modelId: string): ModelReference | undefined;
	hasConfiguredAuth(model: ModelReference): boolean;
	select(model: ModelReference): Promise<boolean>;
	getThinkingLevel(): ThinkingLevel;
	setThinkingLevel(level: ThinkingLevel): void;
}

interface ManagedResourcePort {
	replace(resources: { promptPaths: string[]; skillPaths: string[] }): Promise<void>;
}

interface UiPort {
	notify(message: PresentedMessage): void;
	setWorking(message?: PresentedMessage): void;
	requestDecision(decision: DecisionPrompt): Promise<DecisionAnswer>;
}

interface CommandRegistrationPort<TContext> {
	register(command: ByzInteractiveCommand<TContext>): Disposable;
}

interface ToolCatalogPort {
	list(): readonly ToolDescriptor[];
}

// 仅 adapters/pi 内部可以构造完整 bundle；组合根向每个功能传最小 Pick/组合接口。
interface PiPortBundle {
	runtime: RuntimePort;
	session: SessionPort;
	model: ModelPort;
	resources: ManagedResourcePort;
	ui: UiPort;
	commands: CommandRegistrationPort<unknown>;
	tools: ToolCatalogPort;
}
```

### Build manifest

Build manifest 记录 runtime tree、root assets、docs/examples、workflow roots、BYZ compiled output 和 package metadata 转换规则。新增源码由生产编译输出自动包含；只有新增资源类别才修改 manifest。manifest 校验必须在任何复制前完成，并覆盖 normalized workflow destination 的唯一性与非重叠性；源码根先建立 no-follow provenance，编译输出、package metadata、生成根和 manifest 导出的保留 runtime 目标必须进入同一 portable path namespace，并以全祖先集合或 trie 判定冲突后才允许复制。

Artifact receipt 是 build manifest 之后的发布证明，不替代 build manifest。receipt 由经过重新校验的 current image 和本次 npm pack 结果确定性生成；其 tar entry 清单及大小必须同时与 image、npm pack manifest 和流式 tar header 三方一致。

release dry-run 的机器可读结果是 CI artifact step 与后续步骤之间唯一的制品交接接口，至少返回 `artifactPath`、`receiptPath`、`generationIdentity` 和 `sha256`。这些字段只能在锁内最终 current/receipt 验证成功后输出；CI workflow 只能传递该结果，不能根据 package name/version 或预期文件名重建路径，也不能再次生产 tarball。

## 安全考虑

- Pi Adapter facade 只暴露调用方声明的能力，不保存公开 raw Pi handle；完整 Pi Extension API 只能停留在 `adapters/pi` 的闭包内部。
- managed capability 由 loader 内部 token 绑定，不能通过扩展名冒充。
- Preferences 原子写入且不跟随 symlink。
- 构建复制前校验来源 realpath、输出根 no-follow 边界和 package lock，拒绝越界路径。
- 构建锁使用 owner token + PID + `processStartId`；只在 probe 证明 owner 消失或 PID 身份变化时恢复，任何 ownership 决策点的未知状态都失败关闭。
- 每个完整 owner 目录不可由竞争者移动或删除；锁目录在 owner metadata 完整后才原子可见，并持续持有到 `current` 发布完成，不提供活进程 TTL takeover。
- claim 激活后的最终选举、持有校验和 publication fence 使用同一 competing-owner 判定，不能静默过滤 `unknown` active owner。
- Workflow bundle destination 按 Unicode 规范化、大小写折叠、Windows 保留名/尾随点空格和祖先关系比较，必须可移植地互不重叠。
- BYZ 编译输出、package metadata 与保留 Pi runtime/assets 使用同一可移植 path key；大小写或 Unicode 等价路径不能绕过冲突检查后被复制覆盖，祖先检测不能只检查排序相邻项。
- BYZ `src` 在编译器启动前执行 no-follow 全树验证；外部源码 symlink 不得通过编译产物间接进入 image。
- pointer promotion 状态必须跨后置围栏异常传回编排层；清理无法证明候选 generation 不是 current 时失败关闭并保留 generation。
- release dry-run 在进程身份锁内作为 CI 唯一制品生产者；CI smoke 与 publish 只消费其最终围栏后返回、由 receipt 绑定的相同 tarball 字节，可变 pathname 不是制品身份。
- pack 只向自己原子创建的 output-root 外私有目录写入；调用方 destination 不得成为 npm 的实际写入路径。
- tar 在任何解压、安装、执行或大文件读取前先做 header-only 文件数、类型、单文件与总展开大小检查，拒绝压缩炸弹和特殊条目。
- 发布门禁不声称替代人工法律判断，审批凭证必须绑定 release commit 并由受保护授权边界提供。

## 波及面

| 改动位置 | 直接调用方 | 可能受影响的老功能 | 回归保护 |
| --- | --- | --- | --- |
| `packages/byz/src/cli.js`、`packages/byz/src/*.js` | `byz` bin、BYZ tests | update、workflow、Fast、Prewalk、diagnostics、Execution | BYZ package tests + packed CLI smoke |
| `packages/byz/src/conversation/**` | interactive BYZ extension | 欢迎、进度、Footer、语言、详情、确认 | conversation tests + faux provider TUI tests |
| `packages/byz/package.json`、`packages/byz/scripts/build*.mjs`、`packages/byz/scripts/pack.mjs`、`scripts/byz-release.mjs` | npm workspace links、`build:byz*`、release workflow | CLI/exports、runtime assets、docs、examples、workflows、dry-run/publish artifact | production-build fixture、public package and packed-runtime tests |
| `packages/coding-agent/src/core/resource-loader.ts` | session service/resource reload | 普通 Pi additional/discovered precedence、managed 多 owner snapshot、workflow switching | Pi 默认 collision regression + workflow-switch integration tests |
| `packages/coding-agent/src/core/agent-session.ts`、`extensions/runner.ts`、`extensions/types.ts` | extension command context | managed resource replacement权限 | owner isolation tests |
| `packages/coding-agent/src/modes/interactive/interactive-mode.ts` | Pi/BYZ TUI startup | startup resources/header | interactive faux-provider regression |

## 技术决策

| 决策 | 选项 | 理由 |
| --- | --- | --- |
| 开源形态 | 完整 monorepo | 当前 BYZ 依赖经修改的 Pi hooks，完整历史最可重现 |
| 边界位置 | 先在 `packages/byz` 内分层 | 避免过早增加 workspace release 复杂度 |
| Pi 专属 hook | 泛化后同步迁移 | 降低长期 fork delta，不保留未公开内部兼容包袱 |
| Pi Adapter 形态 | 显式 plain-object ports + 组合根按功能裁剪 | 透明 Proxy 只改变调用路径而不收窄能力，无法建立可审计的运行时依赖边界 |
| Model capability lineage | identity 可保存，handle 只能由当前 context/port 解析 | 同时支持 reload 恢复并拒绝另一 live Session 的引用 |
| Composition gate | canonical source-file/export symbol + alias/re-export chain + exact port-source binding + Reflect mutation 检查 | 导入拼写会同时漏掉 re-export alias 并误报无关同名模块；Reflect.defineProperty 与 Reflect.set 具有相同 raw escape 语义 |
| Prewalk trust | awaited path/tool 检查后、handoff 前重新验证 | 防止 realpath 期间撤销 trust 后仍消费 armed handoff |
| Resource precedence | 普通 Pi 使用兼容默认值；BYZ 通过产品无关配置显式选择 `before` | 防止产品覆盖语义泄漏为全局 Pi 行为，同时支持静态和动态 workflow 冲突策略 |
| Managed themes | startup/reload/command 全部在状态变化前明确拒绝 | managed capability 只承诺 skills/prompts；静默过滤会制造成功假象和部分更新 |
| 命令处理 | Registry + CommandResult | 便于测试、扩展和统一退出语义 |
| 文案隐藏 | 结构化 Presenter | 避免关键词替换破坏用户技术内容 |
| UI 验收 | 既有交互测试 | 本 feature 无新视觉设计 |
| 源码与发布入口 | 源码 metadata 指向 current；image metadata 指向真实 dist | 保持单一 generation pointer，同时让 workspace 与 tarball 入口各自可解析 |
| 构建互斥 | owner token + PID + processStartId 生命周期锁 | 只恢复已确认死亡/身份变化的 owner，消除暂停进程超时复活与旧 generation 重发布 |
| 输出冲突判定 | 统一 portable path key + segment trie/全祖先 prefix 集合 | 不依赖排序相邻性，覆盖被无关 sibling 隔开的文件/目录祖先冲突 |
| 源码 provenance | 编译前 no-follow 递归验证 `src` | 防止编译器跟随 package 外 symlink 并把外部内容转化为普通产物 |
| promotion 异常 | 显式 publication state + current identity 清理围栏 | 后置 fence 失败时保留已 promotion 或状态不确定的 generation，避免 current 悬空 |
| 发布包来源 | 锁内 release dry-run 单次生产；CI smoke/publish 传递同一 artifact receipt | 消除 dry-run artifact A 与后续独立 pack artifact B 的 lineage 分叉 |
| pack destination | pack 原子创建 output-root 外私有目录 | 不把可重定向的调用方 pathname 交给 npm，消除 destination check/use race |
| tar 消费 | receipt + 私有快照 + 流式 header 硬上限 | 在解压或执行前拒绝替换、特殊条目和高展开比压缩包 |
