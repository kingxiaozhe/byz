# Safe Diagnostics Export — 技术设计

## 设计版本

| 日期 | 版本 | 说明 |
| --- | --- | --- |
| 2026-08-30 | v1 | 初始设计 |

## 项目架构

- 架构类型: Node.js npm workspace monorepo
- 涉及层: BYZ diagnostics CLI、白名单读取器、本地导出目录
- 依赖 feature: `1.local-diagnostics-foundation`

## 功能模块设计

### 模块 1: 导出计划与预览

`packages/byz/src/diagnostics/export.js` 先构建只含计数和字段类别的 export plan：

```text
时间范围
有效事件数
拒绝/损坏事件数
将包含的固定文件列表
将包含的字段类别
始终排除的数据类别
目标路径
```

交互终端要求输入确认；非交互调用必须带 `--confirm`。取消不创建临时目录。

### 模块 2: 二次隐私验证

导出不能直接复制本地 JSONL。reader 逐行解析后，export validator 使用独立入口按当前 Schema 重新验证每个聚合输入。以下任一情况使整个导出失败关闭：

- 未知 Schema 版本；
- 未知事件或字段；
- 字段类型/枚举不合法；
- 出现 sensitive-name deny guard 命中的防御性字段名；
- 原始行损坏且无法证明它未进入聚合；
- 摘要包含源路径、文件名或自由文本。

字段白名单是主防线；敏感名称检查只是防御性补充，不能替代白名单。

### 模块 3: 原子本地包

默认导出目录：

```text
~/.byz/diagnostics/exports/byz-diagnostics-<UTC timestamp>/
├── manifest.json
├── summary.json
└── privacy-report.txt
```

不包含原始 events 分片。使用 Node 标准库生成目录包，不引入归档依赖。流程：

1. 在目标父目录创建私有临时目录；
2. 写固定三个文件并设为 `0600`；
3. fsync/close 后，将临时目录原子 rename 为最终目录；
4. 最终目录已存在时拒绝覆盖；
5. 失败或取消后尽力删除临时目录，清理失败返回退出码 2。

用户通过 `--output <path>` 指定目标时，逐级 `lstat` 已存在父目录并拒绝符号链接；最终路径必须不存在。导出器记录已验证父目录的设备号与 inode，在该目录内独占创建临时目录，并在最终 rename 前重新核验父目录 identity；identity 漂移时拒绝完成并清理临时目录。相对路径按当前 cwd 解析，但 manifest 永不记录该路径。

### 模块 4: 网络与 AI 隔离

导出模块只依赖 `node:fs`, `node:path`, `node:os`，不调用 `fetch`、浏览器、GitHub 或 Provider API。CLI 完成后只打印本地路径。

生成包不会把包内容加入 session。用户后续明确提供路径并要求分析时，现有 read 工具权限仍适用；BYZ 不自动读取。

## 接口契约

```text
byz diagnostics export [--since <duration>] [--output <path>] [--confirm]
```

| 结果 | 退出码 |
| --- | --- |
| 导出成功 | 0 |
| 参数错误、取消、未确认、隐私验证失败 | 1 |
| 存储或临时清理失败 | 2 |

`manifest.json` 只含：`schemaVersion`, `generatedAt`, `range`, `eventCount`, `summarySha256`, `byzVersion`, `runtimeCategory`。不得包含源路径、用户名、主机名、项目名或事件原文。

## 数据模型

`summary.json` 复用 foundation 聚合结果的公开安全 DTO。`privacy-report.txt` 使用固定模板和固定类别，不拼接原始字段值。

## 波及面

| 改动 | 直接调用方 | 可能受影响的存量功能 | 回归要求 |
| --- | --- | --- | --- |
| diagnostics command 增加 export 分支 | `byz diagnostics` | foundation 其他子命令解析 | status/summary/doctor/clear 参数测试保持通过 |
| 复用 reader/validator | summary 与 export | reader 严格度变化可能影响摘要 | reader 单测与导出失败关闭用例 |
| 写 exports 目录 | 用户本地诊断目录 | retention/clear | clear 必须覆盖 exports；运行期轮转不得误删进行中的临时目录 |

## 安全考虑

- 不复制原始 JSONL；默认只导出聚合摘要。
- 二次白名单验证失败关闭。
- 不覆盖文件，不跟随符号链接。
- 临时目录与最终文件使用用户私有权限。
- 不联网，不自动分享，不自动加入 AI 上下文。

## 技术决策

| 决策 | 选项 | 理由 |
| --- | --- | --- |
| 包格式 | 私有本地目录包 | Node 标准库可原子生成，无第三方归档依赖或生命周期风险 |
| 原始事件 | 不导出 | 最小化隐私风险，聚合摘要足够支持首轮排障 |
| 校验 | 写入白名单 + 导出二次白名单 | 防止旧文件、损坏文件或未来 Schema 漂移造成泄露 |
| 输出覆盖 | 永不覆盖 | 避免破坏用户文件和 TOCTOU 风险扩大 |
