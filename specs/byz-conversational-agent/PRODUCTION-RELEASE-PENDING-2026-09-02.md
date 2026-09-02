# 生产发布待决清单 — 2026-09-02

- Feature: `4.structured-execution-registry`；Feature 5/6 仅保留规格并 deferred。
- 当前交付: 本地 feature 分支和可回溯 commits；未推送、未创建 PR、未合并、未发布 npm。
- 本地验证: focused 78/78、BYZ package 254 passed + 1 platform skip、`npm run check`、真实 80×24 no-plan/64-task TUI、13/13 持久命令组、业务验收 AC-001 至 AC-015 通过。
- Staging/npm 验证: 未执行；`RELEASES.md` 无本 Feature staging 记录，不把本地 package image 视为已发布。
- 生产迁移: 无数据库迁移、项目状态迁移或全局状态迁移；Session custom entry schema 随代码读取并严格失败关闭。
- 新增环境变量: 无。
- 新增依赖: 无。
- 发布顺序: 人工审查本地分支 → 分别明确授权 push 和 draft PR → 合并 main → 按 BYZ 既有 release 流程构建并发布 patch → 从仓库外安装验证 managed plan、Session reload、80 列交互状态和非交互命令。
- 回滚: npm 发布前反向提交本 Feature commits；npm 发布后将 `latest` dist-tag 回退到上一已验证 BYZ 版本，并发布 forward patch。Session 中未知或新 receipt 在旧版本下必须保持忽略/失败关闭，不做数据改写。
- 生产动作: 全部待人工明确确认；本流程未执行 push、PR、merge、npm publish 或其他远端副作用。
