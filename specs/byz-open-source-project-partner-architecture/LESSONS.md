# Development Lessons

## 待触发备忘

当前无挂起备忘。

## 2026-08-30 — Open Source Runtime Boundaries / T-016

- `[已结构化]` 进程身份锁的失败关闭规则必须复用于首次竞争、激活后最终选举、持有校验和发布围栏；只保护首次扫描仍可能在并发激活窗口返回两个可发布 handle。该约束已落入统一检查函数和 post-activation/publication 回归测试。

## 2026-08-30 — Open Source Runtime Boundaries / T-018

- `[已结构化]` 可移植路径的文件/目录冲突不能依赖排序相邻性；无关 sibling 可以隔开 ancestor 与 descendant。实现改为全祖先 prefix 集合查询，并用 `A.js`、`a.js-foo.js`、`a.js/b.js` 固化回归。
- `[已结构化]` 编译输出已经丢失源码 provenance，不能靠产物 regular-tree 校验发现外部源码 symlink；必须在编译器读取前 no-follow 验证完整 `src`，并证明拒绝时不创建 generation、不切换 `current`。

## 2026-08-30 — Open Source Runtime Boundaries / T-019

- `[已结构化]` “多个阶段都调用同一个 pack helper”不等于同一制品 lineage：release dry-run 生成 artifact A、CI 再生成 artifact B 时，后续 smoke/publish 即使内部一致，也无法由 dry-run 证明。CI 必须只有一个锁内制品生产调用，后续步骤只传递其 content-bound receipt 和字节。
- `[已结构化]` release dry-run 的最终输出属于发布边界；只有在同一进程身份锁下重新确认 ownership、current pointer、generation identity 和 receipt 后才能暴露 artifact 路径，pack 中途切换 current 或锁状态不明必须失败关闭。

## 2026-08-31 — Open Source Runtime Boundaries / T-020

- `[已结构化]` receipt 与 tarball 成对替换时可以形成另一组内部自洽制品，因此 downstream 不能只重新读取 pathname 并验证两者彼此一致；dry-run 的 generation identity 和重算 SHA-256 必须通过独立通道传给 smoke、post-smoke 与 publish，三处都对 expected identity 失败关闭。

## 2026-08-31 — Open Source Runtime Boundaries / T-021

- `[已结构化]` 产品 wrapper 的资源优先级不能通过修改共享默认值实现；普通 Pi 保持 discovered-before-additional，静态 BYZ 才显式选择 additional `before`，动态 BYZ 只依赖 managed owner precedence。分支专属配置必须由行为或分支边界测试证明，不能只搜索配置字符串存在。
- `[已结构化]` reload 中的 managed discovery 属于事务提交边界；主题拒绝不仅要阻止 sibling resources，还必须恢复旧 loader catalogs、capability、tool/prompt registries、runner identity 和 lifecycle。仅构造 `reason: reload` 的新 session 不能代替真实 `session.reload()` 回归。
