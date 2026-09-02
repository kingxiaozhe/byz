# 生产发布待决清单 — 2026-09-02

- 已通过 staging 验证的 feature: 无；`RELEASES.md` 不存在，本次只完成本地测试、静态检查和 feature QA。
- 当前交付: diff，基线 `d3247c7491723a67bb309d62b9627d453a3cbb87`，尚未提交、构建、打包、推送、打 tag 或发布。
- 生产迁移: 无数据库或状态 migration；无需备份数据。
- 新增环境变量: 无。
- 新增运行时依赖: 无。
- 发布前必做:
  1. 将批准范围提交到预定 BYZ release branch，并重新核对工作树。
  2. 按仓库发布规则构建最终 BYZ artifact，在仓库外隔离 HOME 中执行 packed-runtime/CLI smoke；历史 T-008 receipt 不是当前源码字节凭证。
  3. 确认 `packages/byz/CHANGELOG.md` Unreleased 内容进入目标版本。
  4. 仅在人工批准发布后创建匹配 `byz-v*` tag，由既有 GitHub Actions 发布；本清单不授权 push、tag 或 npm 发布。
- 回滚预案: 发布前删除候选 artifact；发布后对交付 commit 使用普通 `git revert <delivery-commit>` 生成前向回滚提交，并按 BYZ 发布规则发布修复版本或回退 npm `latest` dist-tag。不得删除已发布 npm 版本。
- 生产后验证: 从 npm 安装目标精确版本，在 trusted legacy fixture 上验证 startup 固定 warning、`/project details` 脱敏诊断和正常 recovery card；同时验证 untrusted zero-read 与普通 Conversation/Fast/Prewalk/workflow 启动。
