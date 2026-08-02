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
- 数据库迁移已做 Prisma 静态校验；当前没有在真实 PostgreSQL 上执行迁移/并发集成测试，事务锁行为依据 PostgreSQL 语义和数据库唯一约束保障。
