# Task 6 实施报告：T+1 日报、周报、月报与补数重算

## 结果

- 新增累计指标首末快照增量聚合，并按笔记分组后求和，避免把不同笔记的累计总量相减。
- `ReportService.generateReport(type, now)` 统一使用 `Asia/Shanghai` 周期；缺日快照或累计序列只有一个点时生成 `awaiting_data` 版本。
- 补数后通过 `rebuild-report` 再次生成新版本，旧版本保留。
- `Report` 增加 `version/status/missingDates`，唯一键为账号范围 + 类型 + 周期 + 版本。版本号在数据库事务内用 PostgreSQL advisory lock 串行化分配，并由唯一约束兜底。
- 调度器每个上海日生成日报，仅上海周一生成周报，仅上海 1 日生成月报。稳定 job ID 与完成任务保留 8 天防止重启重复入队。

## RED 证据

1. `pnpm --filter @xhs/domain test -- metric-aggregation.spec.ts`：失败，缺少 `metric-aggregation` 模块。
2. `pnpm --filter worker test -- report.service.spec.ts`：失败，缺少 `report.service` 模块。
3. `pnpm --filter worker test -- report.scheduler.spec.ts`：失败，缺少 `report.scheduler` 模块。
4. 多笔记累计指标用例首次失败：期望 `80`，实际 `950`，证明捕获了跨笔记错误相减。
5. 单快照日报用例首次失败：期望 `awaiting_data`，实际 `complete`。
6. 调度重启去重用例首次失败：缺少 `reportJobOptions`；补数任务用例首次失败：缺少 `rebuildReportJob`。

## GREEN 与验证证据

- `pnpm --filter @xhs/domain test`：2 个文件，6 个测试通过。
- `pnpm --filter worker test`：5 个文件，23 个测试通过。
- `pnpm --filter @xhs/domain typecheck`、`pnpm --filter @xhs/database typecheck`、`pnpm --filter worker build`：通过。
- `DATABASE_URL=... pnpm --filter @xhs/database exec prisma validate`：Schema valid。
- `pnpm build`：API、Web、Worker 全部构建通过。

## 自检与注意

- 未纳入工作区中其他任务的 `task-5-report.md` 改动。
- 首轮时仅做 Prisma 静态校验；Fix round 1 已补齐 PostgreSQL 18.4 实际迁移与双连接并发集成测试，详见下文。

## Fix round 1（2026-08-02）

### 修复结果

- BullMQ 定时与重算 job ID 全部改为无冒号稳定 ID。真实 Redis `Queue.add` 验证重算重复入队只保留一份，关闭并重建 Queue 后同一上海业务日仍不重复。
- 指标完整性由“已出现 series”改为账号笔记 × 必需 MetricDefinition × 周期日期的期望矩阵；`missingFields` 按 `noteId/metricDefinitionId/date` 持久化，`missingDates` 从其派生。
- `BackfillEvent` 与快照在同一数据库事务持久化；仅在事务成功返回后触发 hook。`ReportRebuildDispatcher` 查找受补数日期影响的 `awaiting_data` 日/周/月范围并幂等入队，`worker.module` 已完成接线。
- 新版报告保存 `backfillId/rebuildJobId/previousReportId/rebuildReason`，且 processor 将 BullMQ job 上下文传到版本事务。
- 调度 enqueue 失败会被捕获并记录 `service/component/event/error` 结构化错误，不再形成 unhandled rejection。
- 补数受影响日期使用 `Asia/Shanghai` 而非 ISO 字符串的 UTC 日期截断。

### 追加 RED 证据

1. 真实 Redis 重算入队首次失败：BullMQ 6.0.5 报 `Custom Id cannot contain :`；同时定时任务期望的无冒号 ID 与旧实现不符。
2. likes 整段缺失、周报单日缺失用例首次失败：`missingFields` 为 `undefined`。
3. 重算审计用例首次失败：`createVersion` 未收到 `backfillId/rebuildJobId/previousReportId/rebuildReason`。
4. 补数提交后事件用例首次失败：观测到的持久事件数为 0。修正 Mock connector 账号 fixture 后验证 hook 内能反查已提交的 `BackfillEvent`。
5. 受影响 scope 派发用例首次失败：`ReportRebuildDispatcher is not a constructor`。
6. 调度错误用例首次失败：`runScheduledReportTick is not a function`。
7. PostgreSQL 双连接并发用例首次失败：`createDatabaseClient is not a function`。
8. UTC 跨上海零点用例首次失败：`backfillBusinessDates is not a function`。
9. 完整性矩阵边界自检首次失败：周报每个日期单个快照且整个 series 有首末点时被误判为 `awaiting_data`；修正为每个矩阵单元至少一个快照，同时整个累计 series 至少两个点。

### 追加 GREEN / 集成验证

- `report.scheduler.spec.ts`：真实 Redis 入队、重启去重、三类受影响 scope 及错误捕获均通过。
- `report.service.spec.ts`：likes 整段缺失、部分日缺失、结构化缺失字段与重算审计上下文均通过。
- `sync.service.spec.ts`：持久化补数事件与事务提交后 hook 通过。
- `report.repository.integration.spec.ts`：PostgreSQL 18 上两个独立 Prisma 连接并发生成同 scope，版本为 `[1,2]` 且仅有两行；不同 scope 各自为版本 1。
- 实际环境：`postgres:18-alpine` 容器报告 PostgreSQL 18.4；`prisma migrate deploy` 已成功应用 `0002_report_versions` 和 `0003_report_rebuild_audit`。
- 最终 fresh 验证：Domain 6/6；Worker 7 个文件 36/36（含 3 个 PostgreSQL 报告仓储集成用例与审计落库断言）；Database 5/5；Domain/Database typecheck、API/Web/Worker build、`prisma migrate status`、`git diff --check` 全部通过。
