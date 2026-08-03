# Task 1 实施报告

## 完成内容

- 新增上海业务日的月内滚动窗口：非月初产生当月 1 日至昨日，月初产生上一完整自然月。
- 新增由账号、业务日期和模式共同决定的稳定 BullMQ 任务 ID。
- 新增 official 授权账号分页查询和逐账号、逐日入队。payload 包含 `accountId`、`businessDate`、`windowStart`、`windowEndExclusive`、`mode` 和 `source: 'official'`。
- 分页在重复游标、游标与页末账号不一致、重复账号或超过页数上限时 fail closed，且在校验完所有分页前不入队。
- 单个账号入队失败会记录结构化错误，不阻断其他账号。

## TDD 证据

1. 领域 RED：`pnpm --filter @xhs/domain test -- rolling-sync-window.spec.ts` 因 `./rolling-sync-window` 不存在失败。
2. 领域 GREEN：同一命令通过，包含 7 个新增测试。
3. 调度器 RED：worker 测试因 `./sync.scheduler` 不存在失败。
4. 游标完整性 RED：错误页末游标用例首次运行时意外 resolve；增加 fail-closed 校验后 GREEN。

## 最终验证

- `pnpm --filter @xhs/domain test`：4 个文件、29 项测试通过。
- `pnpm --filter worker test`：13 个文件、89 项测试通过。
- `pnpm --filter @xhs/domain typecheck`：通过。
- `pnpm --filter worker typecheck`：通过。
- `pnpm --filter worker build`：通过。

## 包名说明

领域包实际名为 `@xhs/domain`，与计划命令一致；worker 包在 `apps/worker/package.json` 中的实际名为 `worker`，因此 worker 验证使用 `pnpm --filter worker ...`。

## Review Round 1 追加

- 入队故障隔离从账号级细化到单个账号/日期任务；错误中包含 `accountId`、`businessDate` 和 `jobId`，中间日期失败不再中断后续日期。
- Prisma 分页改为 `take: limit + 1` lookahead，Store 自身返回 `hasMore` 和可验证的 `nextCursor`；调度器拒绝缺失、重复或与页末账号不一致的游标。
- 账号按页读取与处理，不再一次性加载全部账号；每页入队使用 16 路有界并发，待当前页全部 settle 后才读取下一页。
- 上海业务日先用 `formatInTimeZone` 提取，自然月运算改用纯 Gregorian/UTC 日历；任务 UTC 边界用 `fromZonedTime` 生成。新增 `TZ=UTC`、`America/Los_Angeles`、`Asia/Shanghai` 下的月界和跨年一致性测试。
- Round 1 最终验证：`@xhs/domain` 4 个文件、30 项测试通过；`worker` 13 个文件、93 项测试通过；两个包的 typecheck 和 worker build 均通过。
