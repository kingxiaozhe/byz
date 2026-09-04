# Delivery Console — 任务清单

## 任务版本

| 日期 | 版本 | 说明 |
| --- | --- | --- |
| 2026-09-02 | v1 | 初始任务；后续批次待批准 |
| 2026-09-02 | v2 | 纳入 P1；Feature 4 依赖更新为 T-009，并增加 Runtime Boundary 与 Safe Pause 前置门禁 |
| 2026-09-02 | v3 | Runtime Boundary 前置门禁更新为人工批准的替代任务 T-025 |
| 2026-09-02 | v4 | Runtime Boundary 前置门禁更新为人工批准的替代任务 T-026 |
| 2026-09-03 | v5 | 前置更新为 Runtime Boundary T-024 与 Safe Pause T-009 最终 QA；批量授权执行 |
| 2026-09-03 | v6 | 归档两轮整体实现审查；新增 T-007 接管 current-scope、side-effect、required-check 与证据门禁 |

## 项目信息

- 项目名: pi-monorepo
- 架构类型: npm workspace monorepo
- specs 路径: `specs/byz-conversational-agent/6.delivery-console/`
- 优先级: P1（Safe Pause and Resume 之后）
- 执行状态: `[COMPLETED]` v6 T-007 已按精简收尾模式完成

## 任务列表

### 防护网与红灯

- [ ] T-001: [DROPPED][CHANGED v4] 运行 BYZ Conversation/Recovery/Git/release 相关基线；确认 Runtime Boundary T-026 与 Feature 5 QA 已完成，再用 fake runner 和临时 Git repo 增加 read-only startup、scope intersection、dirty exclusions、fingerprint drift、逐动作确认、origin/upstream、partial success、redaction 和 no-release 红灯 ~1h
  - 模块: `packages/byz/test/**`、feature prestate/review evidence
  - 覆盖: AC-001 至 AC-015

### Scope tracker 与 Git snapshot

- [ ] T-002: [DROPPED][CHANGED v2] 实现 trusted delivery scope tracker、append-before-commit workspace-relative path + post-mutation digest receipts、strict replay/current digest match、porcelain `-z` closed parser、origin sanitizer、registry/Git readiness selector 和 full local/remote fingerprint；不保存正文、不读取 diff/body、不在 startup 运行 Git ~1h
  - 模块: `packages/byz/src/delivery/scope.js`、`git-snapshot.js`、`readiness.js` 及 focused tests
  - 依赖: T-001、Feature 4 T-009、Open Source Runtime Boundaries T-024、Feature 5 T-009
  - 覆盖: AC-001 至 AC-004、AC-009、AC-012、AC-013

### Intent 与 controlled action runner

- [ ] T-003: [DROPPED][CHANGED v2] 实现 5 分钟 one-time intent linearized reducer 和 git/gh 参数数组 runner：绑定 candidate digest、remote branch OID、PR head/base/checks/mergeability 的 exact-path commit、origin-only push、draft GitHub PR、checks-gated PR merge、每个副作用前重读、post-action observation、partial success 与 timeout；V1 无 release action ~1h30min
  - 模块: `packages/byz/src/delivery/intent.js`、`action-runner.js`、fake runner/temp repo tests
  - 依赖: T-002
  - 覆盖: AC-005 至 AC-012、AC-014

### Adapter 与控制台 UX

- [ ] T-004: [DROPPED][CHANGED v2] 扩展 trusted DeliveryPort/Pi Adapter 并注册 `/deliver status|commit|push|pr|merge|release`；实现 preview、每动作 confirmation、Session receipt、compact/details redaction 和 Agent-running mutation 拒绝 ~1h
  - 模块: BYZ application port、Pi Adapter、CLI、delivery extension/Conversation integration/tests
  - 依赖: T-003
  - 覆盖: AC-001 至 AC-013、AC-015

### 隔离集成验证

- [ ] T-005: [DROPPED][CHANGED v2] 在临时 repo + bare origin + fake gh 中执行 commit/push/PR/merge 正常流、状态漂移、detached/conflict/upstream、push success + PR fail 和 cleanup；证明没有真实 remote、force、tag、publish 或其他 dirty file side effect ~1h
  - 模块: delivery integration tests/evidence
  - 依赖: T-004
  - 覆盖: AC-003、AC-005 至 AC-014

### 最终 QA

- [ ] T-006: [DROPPED][CHANGED v2] 运行 focused delivery/Conversation/architecture、BYZ package 与 `npm run check`；80×24 TUI 验证摘要/确认/readiness，审计 raw fields、startup zero-Git 和 release read-only，完成 Feature QA ~45min
  - 模块: Feature 6 QA/TUI/范围审计
  - 依赖: T-005
  - 覆盖: AC-001 至 AC-015

- [x] T-007: [NEW][P1] 接管 T-001 至 T-006 两轮整体实现：start/end toolCallId 绑定 current plan scope、terminal/outcome/category readiness、per-side-effect revalidation 与 blob/path post-proof、失败远端观察、GitHub required checks/base wiring、完整 receipts/cleanup latch、closed DeliveryPort exec、bare-origin/fake-gh/TUI/隔离 QA ~2h
  - 依赖: 整体 implementation r1/r2、Feature 4 T-009、Runtime T-024、Pause T-009；独立 review 链
  - 覆盖: AC-001 至 AC-015

## 依赖关系

- Feature 6 整体依赖 Feature 4 T-009 已完成并合并、Open Source Runtime Boundaries T-024 完成，以及 Feature 5 T-009 QA 完成。
- T-001 在三项跨 Feature 前置条件满足后开始；T-002 依赖 T-001；T-003 依赖 T-002；T-004 依赖 T-003；T-005 依赖 T-004；T-006 依赖 T-005。

## 风险点

- 独立方案 reviewer 在时限内未返回具体 blockers，已升级人审；执行前必须重点审查 index race、scope replay、PR checks 和 partial remote success。
- Git status 与确认之间会变化；fingerprint 复核和 intent 一次性消费不可省略。
- observed mutation scope 不是 Git 真相，只是可申请交付上限；最终必须与当下 Git diff 求交。
- 控制台不是权限 sandbox，不能声称拦截用户在普通 bash 中执行的所有命令。
- V1 release 只读；任何发布执行都属于新需求并重新审批。
