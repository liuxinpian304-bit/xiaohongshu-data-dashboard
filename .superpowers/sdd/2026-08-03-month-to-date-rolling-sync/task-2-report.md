# Task 2 实施报告

## 完成内容

- official 滚动任务 payload 由 processor 完整传入并持久化到 `SyncJob.payload`；不接受不完整或非 official 的滚动 payload。
- 相同 official 观测重放不新增 revision，也不新增 backfill outbox；观测变化时追加 revision，保留 supersedes/supersededAt 不可变证据链。
- backfill 事件 ID 由笔记、业务日与观测摘要决定；复用既有 claim/lease/token 发送机制。
- 已提交业务日会命中最新的日报、自然周报、自然月报作用域，每个作用域使用稳定 rebuild job ID，重放不重复入队。
- 月初终检依赖现有完整性矩阵：所有日期和必需指标完整才产生 `complete`；缺失则保持 `awaiting_data` 并记录精确日期/字段，覆盖 31 天和跨年。
- 通知生产已分流：初次完整为 `report_generated`，补数完整为 `report_rebuilt`，缺数为 `report_awaiting_data`；通知失败不回滚同步或报告。
- 未实现 self_import，未更改 mock connector，未将离线导入标记或混算为 official。

## TDD 证据

- RED：official 相同观测测试观察到重复 outbox；最新 complete 报告作用域返回空；`awaiting_data` 被误发为 `report_generated`。
- GREEN：聚焦套件 13 个文件、100 项测试全部通过。

## 全量验证

- domain：4 文件，30 项通过。
- worker：13 文件，100 项通过。
- API：11 文件，64 项通过。
- connector：1 文件，11 项通过。
- web：6 文件，18 项通过。
- 全 workspace typecheck 通过；web/worker/API build 通过。
- Prisma：19 个迁移，database schema is up to date。
- `git diff --check` 通过。

## 注意事项

- database package 的 2 个集成文件、7 项测试通过，并执行了 database typecheck 和 Prisma 迁移状态检查。
- 工作树中既有 `.superpowers/sdd/2026-08-02-xiaohongshu-dashboard-implementation/task-5-report.md` 修改未触碰、未纳入提交。

## Review Round 1 修复

- `BackfillEvent` 持久化 `source`/`mode`/`businessDate`；official 滚动或修订可重建最新 complete 作用域，mock 保留仅补全 awaiting 的旧行为，历史无法证明来源的事件标为 `legacy` 并 fail closed。
- official payload 在运行时验证真实 `YYYY-MM-DD` 上海日期、精确午夜半开窗口和允许的 mode；同步前验证账号为未撤销、有有效凭证与已启用能力的 official 账号。
- official connector 指标在提交前验证：`capturedAt` 必须落在任务日窗口，非累计权威指标的 window 必须与任务半开窗口精确相等；错位时零证据、零 outbox。
- `ReportResult.reports[]` 每项携带自身 `missingDates`/`missingFields`，通知生产仅使用该项数据，不会在多账号间泄漏汇总缺失。
- Round 1 RED 分别捕获 mock 误重建 complete、坏日期/错窗仍调用 service、伪 official 账号通过、connector 错位仍提交、A/B 通知共用汇总缺失。
- Round 1 全量测试：domain 30、worker 108、API 64、database 7、connector 11、web 18，全部通过；Prisma 共 21 个迁移。
