# Structured Execution Roadmap — 需求来源

## 背景

Turn Token Usage v3 已能可靠展示当前状态、耗时、observed Token 和运行中工具，但由于没有可靠 runtime task registry，不能展示 Tasks、真实步骤进度或结构化验证证据。

## 已确认方向

1. 结构化任务与验证证据注册表：Workflow 发出结构化任务和证据事件，界面只在有可证明总量时显示步骤进度，不解析模型自然语言，不生成虚假百分比。
2. 暂停与安全续跑：提供 `/pause` 与 `/resume`，在安全边界暂停，保留当前 Session 和任务状态，并与 abort、confirmation 明确区分。
3. 交付控制台：任务完成后统一展示修改范围、测试与审查结果、分支/提交状态，并对提交、推送、PR、合并、发布分别设置人工门禁。

## 推荐顺序

先完整设计三个 Feature；Feature 1 是 Feature 2 和 Feature 3 的基础，优先开发。Feature 2 和 Feature 3 在 Feature 1 稳定后执行。

## 默认安全边界（规格中需验证）

- 默认紧凑输出继续隐藏命令、参数、路径、tool result、Prompt 和响应正文。
- 不把 CM specs task 数冒充 runtime task 数。
- 不解析自然语言推导任务、证据或完成比例。
- 未获得明确授权时不执行 push、PR、merge、生产发布或基础设施变更。
- 无法证明的数据保持未知或省略，不以零、成功或完成代替。
