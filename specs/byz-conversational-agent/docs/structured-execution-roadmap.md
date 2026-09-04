# Structured Execution Roadmap — 需求来源

## 背景

Turn Token Usage v3 已能可靠展示当前状态、耗时、observed Token 和运行中工具，但由于没有可靠 runtime task registry，不能展示 Tasks、真实步骤进度或结构化验证证据。

## 已确认方向

1. 结构化任务与验证证据注册表：Workflow 发出结构化任务和证据事件，界面只在有可证明总量时显示步骤进度，不解析模型自然语言，不生成虚假百分比。
2. 暂停与安全续跑：提供 `/pause`、`/pause resume` 与 `/pause abort`，在安全边界暂停，保留当前 Session 和任务状态，并与 Pi Session `/resume`、abort、confirmation 明确区分。
3. 交付控制台：任务完成后统一展示修改范围、测试与审查结果、分支/提交状态，并对提交、推送、PR、合并、发布分别设置人工门禁。

## P1 执行结果（v3）

1. `open-source-runtime-boundaries` 已由 T-024 最终 QA 收口，包含 canonical capability provenance、统一 Command Registry、Conversation 边界和并发安全偏好存储。
2. Feature 5 `safe-pause-resume` 已由 T-009 最终 QA 收口，稳定 model/tool gate、confirmation lease、并行 drain、stale receipt 与独立 pause timing。
3. Feature 6 `delivery-console` 已由 T-007 收口，提供 current-plan digest scope、分类验证门禁、逐动作确认、origin-bound GitHub PR/checks 和只读 release readiness。

Feature 4 已由 T-009 完成并合并；三项 P1 本地实现与 QA 均完成。远端 commit、push、PR、merge、npm publish 和生产变更仍需独立人工授权。

## 默认安全边界（规格中需验证）

- 默认紧凑输出继续隐藏命令、参数、路径、tool result、Prompt 和响应正文。
- 不把 CM specs task 数冒充 runtime task 数。
- 不解析自然语言推导任务、证据或完成比例。
- 未获得明确授权时不执行 push、PR、merge、生产发布或基础设施变更。
- 无法证明的数据保持未知或省略，不以零、成功或完成代替。
