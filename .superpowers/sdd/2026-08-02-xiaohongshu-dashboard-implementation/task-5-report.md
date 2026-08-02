# Task 5 Report: 同步编排器、断点与限流重试

## Status

DONE

## 实现

- 固定阶段状态机：`authorize -> notes -> metrics -> comments -> replies -> complete`。
- `SyncCheckpoint` 持久化每个 job/stage/entity 的 cursor 与完成状态。
- notes/comments/replies 的每页 upsert 与 cursor 更新在同一 Prisma 事务中提交。
- 重复 cursor 立即停止，job 标记为 `unverifiable`；重跑使用持久化 cursor，upsert 保证幂等。
- BullMQ `sync-account` 使用 `sync:{accountId}:{businessDate}`；6 次尝试、指数退避 1s、50% 抖动。
- 401/403 转为 `UnrecoverableError`；429 保持可重试，由 BullMQ 执行退避。每个账号是独立 job。

## RED 证据

1. `pnpm --filter worker test -- sync.service.spec.ts`：先修正 Worker 依赖装配后，失败于 `Cannot find module './sync.repository'`，证明断点续传测试在实现前为红。
2. `pnpm --filter worker test -- queues.spec.ts`：失败于 `Cannot find module './queues'`，证明稳定 jobId/退避策略在实现前为红。
3. 新增 notes 重复 cursor 测试首次运行：`expected 'complete' to be 'unverifiable'`，暴露阶段错误继续推进的真实缺陷。

## GREEN 证据

- `pnpm --filter worker test`：3 files passed，9 tests passed。
- `pnpm --filter worker typecheck`：退出码 0。
- 真实 Redis 加入队列返回 job id `sync:account-1:2026-08-02`。
- 真实 Postgres 迁移 `0002_sync_checkpoints` 已成功应用，Prisma Client 重新生成。

## 自检

- `git diff --check` 通过。
- 未向生产 `XhsConnector`/`MockXhsConnector` 添加测试专用 fault API；故障注入仅存在测试 decorator。
- 无已知功能阻塞。
