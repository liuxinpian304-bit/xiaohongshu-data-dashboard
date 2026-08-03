# Month-to-Date Rolling Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 每天同步本月 1 日至昨天，并在每月 1 日完成上月全量终检后生成月报。

**Architecture:** 在 domain 中建立唯一的上海时区滚动窗口函数，Worker 调度器只消费该函数生成确定性逐日任务。月初终检以独立批次追踪完整性，并复用现有快照修订、报告重建 outbox 与通知链路。

**Tech Stack:** TypeScript、NestJS Worker、BullMQ、Prisma/PostgreSQL、Vitest。

## Global Constraints

- 只使用小红书官方 API 连接器；mock 数据不得进入正式同步或报告。
- 所有业务日期按 `Asia/Shanghai` 解释，持久化窗口使用 UTC 半开区间。
- 重复值幂等，变化值追加证据修订；不得覆盖历史快照。
- 账号数量无产品上限；调度必须分页且具备游标循环保护。
- 任一日期或指标缺失时，报告保持 `awaiting_data`，不得用 `0` 代替。

---

### Task 1: 月内滚动同步窗口与任务身份

**Files:**
- Create: `packages/domain/src/rolling-sync-window.ts`
- Create: `packages/domain/src/rolling-sync-window.spec.ts`
- Modify: `packages/domain/src/index.ts`
- Modify: `apps/worker/src/sync/sync.scheduler.ts`
- Test: `apps/worker/src/sync/sync.scheduler.spec.ts`

**Interfaces:**
- Produces: `getRollingSyncDates(now: Date): { mode: 'month_to_date' | 'previous_month_final'; dates: string[] }`，日期格式固定为 `YYYY-MM-DD` 上海业务日。
- Produces: `rollingSyncJobId(accountId: string, date: string, mode: string): string`，同一账号、日期、模式始终产生相同 ID。

- [ ] **Step 1: 写失败的领域测试**

覆盖 `2026-08-03 → [08-01,08-02]`、`2026-08-04 → [08-01,08-02,08-03]`、`2026-09-01 → 08-01..08-31 previous_month_final`、`2027-01-01 → 2026-12-01..12-31`，并断言当天不进入窗口。

- [ ] **Step 2: 运行领域测试并确认因函数不存在而失败**

Run: `pnpm --filter @xhs/domain test -- rolling-sync-window.spec.ts`

- [ ] **Step 3: 实现上海时区自然月窗口**

使用现有日期工具风格生成连续日期数组，不读取主机本地时区；月初返回上一完整自然月，其他日期返回当月 1 日至昨天。

- [ ] **Step 4: 写并运行调度器失败测试**

断言多账号逐日任务 ID 稳定、重复 tick 不重复、账号分页游标异常时 fail closed、单账号入队失败不阻断其他账号。

- [ ] **Step 5: 实现确定性 BullMQ 任务生成并验证**

任务 payload 必须包含 `accountId`、`businessDate`、`windowStart`、`windowEndExclusive`、`mode`、`source: 'official'`；不得包含 mock 账号。

- [ ] **Step 6: 提交**

Commit message: `feat: schedule month-to-date rolling sync`

### Task 2: 月初终检、报告重建与通知联动

**Files:**
- Modify: `apps/worker/src/sync/sync.service.ts`
- Modify: `apps/worker/src/sync/sync.repository.ts`
- Modify: `apps/worker/src/report/report.scheduler.ts`
- Modify: `apps/worker/src/report/report.service.ts`
- Modify: `apps/worker/src/notifications/event-producers.ts`
- Test: `apps/worker/src/sync/sync.service.spec.ts`
- Test: `apps/worker/src/report/report.scheduler.spec.ts`
- Test: `apps/worker/src/report/report.service.spec.ts`

**Interfaces:**
- Consumes: Task 1 的逐日 payload 和确定性任务 ID。
- Produces: 月初终检批次状态；完整后排队上月月报，缺失时保持 `awaiting_data`。

- [ ] **Step 1: 写重复抓取与修订失败测试**

断言相同官方值不新增 revision；变化值追加 revision，并为受影响日报、周报、月报各创建一次确定性重建 outbox。

- [ ] **Step 2: 运行测试确认旧实现未覆盖月内滚动影响范围**

Run: `pnpm --filter worker test -- sync.service.spec.ts report.scheduler.spec.ts`

- [ ] **Step 3: 实现逐日同步完成事件与受影响报告范围**

每个已提交业务日计算其所属日报、自然周报和自然月报作用域，复用现有 outbox claim/lease/token 机制；重复事件不得重复发布有效重建任务。

- [ ] **Step 4: 写月初终检失败测试**

断言 31 天全部完成才生成 `complete` 月报；任一天或必需指标缺失则月报为 `awaiting_data`，并准确记录缺失日期/字段；跨年同样成立。

- [ ] **Step 5: 实现月报门控与通知**

终检完成发布 `report_generated`；缺失发布同步失败/等待数据通知；补数修订后发布 `report_rebuilt`，通知失败不得回滚同步或报告。

- [ ] **Step 6: 全量验证**

顺序运行 domain、worker、API、database、connector、web 测试，所有 typecheck/build，迁移状态与 `git diff --check`。

- [ ] **Step 7: 提交**

Commit message: `feat: finalize rolling monthly reports`

