# BYZ Trusted CM Recovery Card —— 产品需求文档

> 成熟度：L2 成熟 PRD
> 类型：B CLI / 开发者工具
> 优先级：P0
> 范围版本：v5（reader tests-only closure）
> 一句话：在受信任且存在 CM 状态的项目中，聚合项目内 CM、Pi Session 与 details-only Git HEAD，让开发者在新会话中快速、安全地恢复工作。

## 1. 问题陈述

CM 已经保存任务、审批、执行、审查、QA 和运行日志；Pi 已经支持 Session resume；Git 已经记录代码状态。

问题是这些信息彼此分散。用户启动 BYZ 后仍然无法直接知道：

- 当前在做什么
- 为什么暂停
- 当前任务有什么结构化凭证
- 当前 Git HEAD 是什么
- 是否可以重新进入 CM，以及应该从哪里进入

BYZ 不应重新建设任务或记忆系统，而应把现有事实源聚合成可操作的恢复入口。

## 2. 目标用户

长期维护代码项目，并使用 BYZ + CM 完成开发工作的个人开发者。

## 3. 核心原则

1. **只聚合，不重建事实源。**
2. **只支持已受信任且存在有效 CM 状态的项目。**
3. **首版只读，任何继续动作都需要用户明确触发。**
4. **状态必须来自证据，不允许模型推测。**
5. **安全失败优先于勉强恢复。**
6. **优先零新增依赖。**

## 4. 用户故事与验收标准

### US-1：查看当前工作

作为开发者，我希望启动 BYZ 时直接看到当前任务和状态。

验收标准：

- 已受信任且存在有效 CM active pointer 时展示恢复卡。
- 显示当前 Feature、Task、CM 节点和状态。
- 用户可在关闭恢复卡后通过显式入口重新查看。
- 不存在有效 CM 状态时正常进入 BYZ，不展示猜测结果。

### US-2：理解暂停原因

作为开发者，我希望知道工作为什么停止，而不是阅读完整日志。

验收标准：

- 展示最近一次有效的 pause、decision、review 或 blocked 证据。
- 第二轮审查阻塞时明确说明禁止继续第三轮。
- 不把自由文本错误、工具输出或模型回答直接显示为权威状态。
- 多个证据冲突时显示“需要核对”，不自行选择结论。

### US-3：核对当前证据

作为开发者，我希望知道当前任务、状态和 review 是否有结构化依据。

验收标准：

- 首版只展示 manifest、status、run pointer、task checkbox 和当前任务 review header 支持的事实。
- details 可展开查看相对来源路径、当前 review 摘要和当前短 HEAD。
- review 一律标为“历史记录，未重验”，不得据此宣称当前代码已批准或完成。
- 历史 build/test/QA/delivery 聚合推迟到 P1；不在卡片中展示源码、Prompt、密钥或原始命令输出。

### US-4：安全继续

作为开发者，我希望从正确入口继续工作。

验收标准：

- 只提供固定的 BYZ/CM/Pi 动作，不从状态文件动态生成命令。
- 推荐 CM 入口前再次检查 project trust 与项目内 CM 状态。
- CM 状态发生变化时停止展示旧投影，并要求重新查看恢复卡。
- blocked、awaiting review、awaiting decision 等状态必须进入对应流程，不能统一解释为继续编码。

### US-5：拒绝不可信项目

作为开发者，我希望打开陌生项目时 BYZ 不会扫描其中的状态文件。

验收标准：

- project trust 通过前不读取 CM、Git 或 Session 恢复数据。
- 不进行“仅元数据”降级扫描。
- trust 被撤销后停止读取，并清除本次会话中的恢复投影。
- 恶意项目不能通过 symlink、路径穿越或伪造 pointer 读取项目外文件。

## 5. 功能需求

- **FR-1**：复用 Pi project trust 作为唯一项目读取授权。
- **FR-2**：只扫描当前项目 `specs/` 最多 64 个直属目录，不递归、不读取全局 CM index 或跨项目状态。
- **FR-3**：读取最小 CM 状态：
  - feature-local `tasks.md`
  - `.cm-specs-status`
  - `.cm-status.json`
  - `.cm-run.json`
  - 当前任务相关 `.reviews/` header
- **FR-4**：读取 Pi 已有 Session continue/resume 信息，不复制会话正文。
- **FR-5**：只在 `/project details` 中惰性读取当前短 Git HEAD；首版不读取 branch、working-tree、diff、remote 或相关提交。
- **FR-6**：输出统一恢复状态：
  - 可继续
  - 需要核对
  - 需要用户决定
  - 已阻塞
  - 状态不可用
- **FR-7**：启动时展示简洁恢复卡，详情按需展开。
- **FR-8**：所有操作使用固定动作映射，不执行状态文件中的命令。
- **FR-9**：恢复卡异常不得阻止 BYZ 正常启动。
- **FR-10**：不得新增平行 Task、Decision、Checkpoint 或 Memory 数据库。

## 6. 安全要求

### 文件与路径

- 每次读取前重新验证 project trust。
- 使用 no-follow 文件访问。
- 拒绝 symlink、junction、非普通文件和项目外路径。
- 限制候选目录数、当前 review 文件数、单文件大小和 snapshot 总读取量。
- 文件读取与继续动作之间发生状态变化时失败关闭。

### 内容安全

- JSON 和 Markdown header 只作为数据解析；首版不读取 JSONL。
- 清理 ANSI、OSC、控制字符和超长字段。
- 不展示 Prompt、模型回答、工具参数、源码正文、环境变量和凭证。
- 不允许日志内容改变恢复卡动作或权限。

### 命令安全

- 禁止字符串拼接 Shell。
- Git、CM 和 Pi 调用使用固定 executable 与参数数组。
- 设置执行超时、输出上限和退出码检查。
- 首版不自动执行恢复动作。

### npm 发布安全

- 优先零新增依赖。
- 新依赖必须检查许可证、安装脚本、维护状态和安全记录。
- 精确锁定依赖版本并审查 lockfile。
- 在仓库外、隔离 HOME 中安装最终 tarball。
- 检查发布包不含状态日志、绝对本机路径、密钥或开发产物。
- 安装和普通启动不得执行非必要生命周期脚本。

## 7. 异常与边缘状态

| 场景 | 行为 |
|---|---|
| 项目未受信任 | 不读取、不展示 |
| CM pointer 指向项目外 | 拒绝并记录本地安全诊断 |
| 状态文件缺失 | 显示状态不可用或不展示恢复卡 |
| JSON 或 review header 损坏 | 不使用损坏来源，不能确定则状态不可用或需要核对 |
| 文件超出大小限制 | 停止读取该来源，不读取整文件 |
| Task 与 review 冲突 | 显示需要核对 |
| Git 仓库损坏或超时 | Git 信息不可用，但不阻塞 BYZ |
| trust 在读取中撤销 | 丢弃结果 |
| 状态在点击继续前变化 | 拒绝继续并刷新 |
| 恶意终端字符 | 转义或删除 |
| 旧 schema | 只读兼容；无法确认语义则拒绝恢复 |

## 8. 复用决策

| 来源 | 复用方式 |
|---|---|
| CM Workflow | 首版直接复用项目内任务、状态、run pointer 和当前 review/handoff header |
| Pi project trust | 直接复用，不另建信任体系 |
| Pi SessionManager | 直接复用 continue/resume |
| Git | details-only 读取当前短 HEAD；working-tree 摘要推迟到 P1 |
| [projectmem](https://github.com/riponcm/projectmem) | 借鉴 session-start `brief` 产品形态，不引入其 Python/hooks/watcher |
| [OwnMem](https://github.com/grpcer/ownmem) | 后续记忆治理参考，P0 不引入 |
| [Beads](https://github.com/gastownhall/beads) | 与 CM tasks 重复，不引入 |
| [Brigade](https://github.com/escoffier-labs/brigade) | 与 CM handoff/receipt 重复，不引入 |

## 9. 成功指标

- 用户在启动后 **30 秒内**理解当前状态和下一步。
- 未受信任项目的恢复文件读取次数为 **0**。
- 没有凭证却被显示为完成的次数为 **0**。
- 恢复卡故障导致 BYZ 无法启动的次数为 **0**。
- 预存路径逃逸、边界超限和终端注入测试全部被拒绝或安全降级。
- 首版不引入新的运行时依赖。

## 10. 非目标

- 非 CM 项目恢复
- 长期记忆和自动事实提取
- 新任务管理系统
- 团队协作与云同步
- 自动继续编码
- 自动修复损坏状态
- 插件市场或第三方恢复 Provider
- 项目仪表盘
- 跨项目/全局 CM 索引恢复
- 历史 QA、delivery 和完整运行日志聚合
- Git branch、working-tree 变化摘要和代码漂移证明

## 11. 里程碑

### M1：只读状态投影

聚合项目内最小 CM 状态与 Pi Session，输出统一恢复状态；Git HEAD 仅在 details 中补充。

### M2：恢复卡

加入启动展示、详情展开和显式继续入口。

### M3：安全与发布验证

完成预存路径逃逸、可见 identity 变化、边界超限、终端注入及一次最终 npm tarball 测试。

预计总周期：**1–2 周**。

## 12. 已确认决策

- compact 不调用 Git；`/project details` 才显示当前短 HEAD。
- dismiss 只对当前 Session 生效。
- 安全拒绝显示一次简短 warning，并写脱敏 diagnostics reason code。
- 首版不读取全局 CM index、运行日志、历史 QA/delivery 或 Git working-tree；这些能力推迟到 P1。
- task/review Markdown 使用 CM canonical line protocol，不作为通用 YAML 解析；quoted/escaped/explicit-key 和 task-shaped 非 canonical 行直接拒绝。
- Reader 最终门禁必须分别覆盖 done/actionable 生命周期、project/specs/leaf identity replacement、非普通叶子和当前平台可用 junction/reparse 变体；T-012 只补测试及测试证实的最小修复。
