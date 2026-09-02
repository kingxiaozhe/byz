# 生产发布待决清单 — 2026-09-02

- Feature: `3.turn-token-usage` v3/v4
- 当前交付: 本地 diff；未提交、未推送、未创建 PR、未发布 npm。
- 本地验证: focused 40/40、BYZ package 216 passed + 1 skip、`npm run check`、80×24 TUI、2/2 mutations、业务验收通过。
- Staging/npm 验证: 未执行；没有 staging 发布记录，不把本地构建视为已发布。
- 生产迁移: 无数据库或状态迁移。
- 新增环境变量: 无。
- 新增依赖: 无。
- 发布顺序: 人工审查 diff → 明确授权提交/PR → 合并 main → 按 BYZ 既有 release 流程构建并发布 patch → 从仓库外安装验证交互状态和非交互命令。
- 回滚: npm 发布前丢弃或反向提交本 feature diff；npm 发布后将 `latest` dist-tag 回退到上一已验证 BYZ 版本，并发布 forward patch。
- 生产动作: 全部待人工明确确认；本流程未执行远端或生产副作用。
