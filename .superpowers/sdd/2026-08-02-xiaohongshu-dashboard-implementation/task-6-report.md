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

## Fix round 2（2026-08-02）

### 修复结果

- 报告存储接口现在固定解析 `views/likes/comments` 三个必需 key；数据库无定义或少定义时仍返回完整要求，并以 `metricKey`、`metricDefinitionId: null`、`reason: metric_definition_missing` 持久表达缺失，报告只能是 `awaiting_data`。
- `BackfillEvent` 成为事务 outbox，新增 `dispatchStatus/attempts/lastError/dispatchedAt`。指标快照和 pending 事件同事务提交；Redis 派发失败被结构化记录，不再让已成功的指标同步失败。
- Worker 启动及每分钟扫描 pending/failed outbox。重试继续使用 backfill + report scope 稳定 job ID，首次失败后可经真实 Redis 恢复，重复扫描不重复入队。
- 受影响报告按 account + type + period start/end 分 scope，只检查每个 scope 的全局最新版本；历史 v1 awaiting、最新 v2 complete 不再触发 v3。

### RED 证据

1. `pnpm --filter worker test -- report.service.spec.ts report.scheduler.spec.ts report.repository.integration.spec.ts`：12 个失败；必需定义新接口不存在、Redis 首次失败仍 reject、真实 PostgreSQL stale awaiting 返回 v1。
2. outbox 集成测试初次验证发现没有受影响 scope 时会直接 dispatched；将测试改为先持久化真实 awaiting scope 后，确认 Queue.add 失败路径及持久状态。

### GREEN / 最终验证

- 测试文件：`report.service.spec.ts`（10）、`report.scheduler.spec.ts`（10）、`report.repository.integration.spec.ts`（4）、`sync.service.spec.ts`（9）。
- `pnpm --filter worker test`：7 个文件，41/41 通过；含 PostgreSQL 18 与真实 Redis 首次失败、扫描恢复、重复扫描幂等。
- `pnpm --filter @xhs/domain test`：2 个文件，6/6 通过。
- `pnpm --filter @xhs/database test:integration`：2 个文件，5/5 通过。
- `pnpm --filter @xhs/domain typecheck`、`pnpm --filter @xhs/database typecheck`、`pnpm --filter worker typecheck`：通过。
- `pnpm build`：API、Worker、Web 全部通过。
- PostgreSQL 18：迁移 `0004_backfill_outbox` 应用成功；`prisma migrate status` 报 6 migrations、schema up to date。
- `git diff --check`：通过。

## Fix round 3（2026-08-02）

### 修复结果

- 重算 job ID 改为 `backfillId + accountId + report type + periodStart + periodEnd` 的稳定 SHA-256 scope 摘要，不再依赖可变化的 `report.id`，且保持 BullMQ 要求的无冒号格式。
- outbox 扫描使用 PostgreSQL `FOR UPDATE SKIP LOCKED` 原子 claim，事件进入 `processing` 并记录 `claimToken/claimedAt`；两个 worker 或重叠 tick 不能同时取得同一事件。
- processing lease 为 5 分钟；worker 崩溃后过期 claim 可被下一轮回收。成功写 dispatched，失败写 failed；状态更新受 claim token 约束。
- claim 查询错误在顶层转换为 `report-rebuild-outbox/claim_failed` 结构化日志并正常返回。批内逐事件隔离，派发或状态持久化错误不会阻断后续事件。

### RED 证据

- `pnpm --filter worker test -- report.scheduler.spec.ts sync.service.spec.ts`：3 个失败；旧 scanner 不调用原子 claim，因此重试 job 数为 0、首事件/第二事件均未处理、claim failure 无结构化日志。

### GREEN / 最终验证

- `report.scheduler.spec.ts`：12/12；覆盖批内状态写失败隔离与顶层 claim failure。
- `sync.service.spec.ts`：9/9；真实 PostgreSQL/Redis 覆盖双 dispatcher 并发 claim、首次失败恢复、processing lease 回收，以及同 backfill/scope 从 v2 到 v3 仍仅一个 job。
- `pnpm --filter worker test`：7 个文件，43/43 通过。
- `pnpm --filter worker typecheck`：通过。
- `pnpm build`：API、Worker、Web 全部通过。
- PostgreSQL 18：`0005_backfill_outbox_claim` 已应用；`prisma migrate status` 报 7 migrations、schema up to date。
- `git diff --check`：通过。

## Fix round 4（2026-08-02）

### 修复结果

- outbox 的 `dispatched/failed` 终态写入现在必须携带 claim token，并且仅匹配 `id + claimToken + processing`；无 token、错误 token 和已被回收的 stale token 都不能覆盖当前 owner。
- `BackfillCommittedEvent` 与 `ClaimedBackfillEvent` 分离，`handle` 仅接受已 claim 事件，状态存储接口的 claim token 改为必填。
- 事务提交后 hook 不再直接派发未 claim 事件，而是立即唤醒 `dispatchPending`，保留即时派发体验，同时强制先原子 claim 再派发。

### RED 证据

- `pnpm --filter worker test -- sync.service.spec.ts`：owner 保护用例失败，期望事件保持 `processing/current-owner/attempts=0`，实际无 token 调用将其改为 `dispatched/claimToken=null/attempts=1`，证明捕获了无条件覆盖。

### GREEN / 最终验证

- `pnpm --filter worker test`：7 个文件，45/45 通过；新增真实 PostgreSQL 用例覆盖无 token、错误 token 和 lease 回收后 stale owner 无法改写。
- `pnpm --filter worker typecheck`：通过。
- `pnpm build`：API、Worker、Web 全部构建通过。
- PostgreSQL 18：`prisma migrate status` 报 7 migrations，database schema up to date。

## Fix round 5（2026-08-02）

### 修复结果

- outbox 终态 `updateMany` 现在必须恰好更新 1 行：0 行抛出 `OwnershipLostError`，多于 1 行抛出 `DispatchStateConsistencyError`，不再丢弃 `count`。
- 缺失、错误或 stale claim token 都不能静默完成终态写入。
- `dispatchPending` 将所有权丢失结构化记录为 `claim_lost`，不覆盖新 owner，并继续处理同批后续事件。`markDispatchFailed` 自身丢失所有权时直接向外传播，不会递归重试终态写入。

### RED 证据

- `pnpm --filter worker test -- report.scheduler.spec.ts`：3 个新用例失败；0 行和 2 行终态更新都错误 resolve，stale owner 还调用了 `markDispatchFailed`。

### GREEN / 最终验证

- `pnpm --filter worker test`：7 个文件，48/48 通过；包含 0 行所有权丢失、多行一致性错误、`claim_lost` 日志、无递归失败写及批内继续处理。
- `pnpm --filter worker typecheck`：通过。
- `pnpm build`：API、Worker、Web 全部构建通过。
- PostgreSQL 18：`prisma migrate status` 报 7 migrations，database schema up to date。
- `git diff --check`：通过。
