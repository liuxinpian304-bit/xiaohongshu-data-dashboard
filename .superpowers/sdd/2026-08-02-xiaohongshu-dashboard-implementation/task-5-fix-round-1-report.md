# Task 5 Fix Round 1 Report

## Status

DONE

## Important 修复

1. 新增 `CommentSyncCompleteness`，按 `connectorType + accountId + notePlatformId` 唯一，持久化 `partial` / `page_complete` / `failed` / `authorization_required` / `unverifiable`。`page_complete` 仅在 `nextCursor=null` 的页数据事务内写入。
2. 重复 nextCursor 不再丢弃响应页：页数据、checkpoint cursor、完整性 `unverifiable` 和 job 状态同一 Prisma 事务提交后停止。
3. metrics/comments/replies 的 Note 查找全部改为 `connectorType_platformId` 复合键，调用链传递 connectorType。
4. Redis 集成测试真实调用 `Queue.add`，验证稳定/重复 jobId 及存储后 attempts/backoff/jitter。边界：测试验证 BullMQ 保留的 job opts，不依赖墙钟时间去断言随机 jitter 的精确延迟。
5. 同一真实 Worker/Queue 加入两个账号 job：401 job 失败且不重试，另一 job 仍 fulfilled。
6. 重跑 job 在进入 running 时重置 `verificationStatus=verified`，成功后不再保留旧 `unverifiable`。

## 覆盖测试

- `apps/worker/src/sync/sync.service.spec.ts`：失败/恢复完整性、重复 cursor 页不丢失、授权不足、connector 隔离、verificationStatus 恢复。
- `apps/worker/src/queues.spec.ts`：真实 Redis enqueue 幂等与退避 opts；同一 Worker/Queue 的单账号失败隔离。
- `apps/worker/src/sync/sync.processor.spec.ts`：401/403 不可重试，429 保持可重试。

## RED 证据

- `pnpm --filter worker exec vitest run src/sync/sync.service.spec.ts`：6/6 失败，`Cannot read properties of undefined (reading 'deleteMany')`，缺少完整性模型。
- `pnpm --filter worker exec vitest run src/queues.spec.ts`：2 failed / 2 passed，`enqueueAccountSync is not a function`。
- 重复 cursor 原测试修正为保留第二响应页；修复前实现只有 5 条，新期望为 10 条。
- `pnpm --filter worker exec vitest run src/sync/sync.service.spec.ts -t "clears unverifiable" --maxWorkers=1`：`expected 'unverifiable' to be 'verified'`。

## GREEN 证据

- 聚焦 DB：`pnpm --filter worker exec vitest run src/sync/sync.service.spec.ts` → 6/6 passed（加入状态恢复后最终 7/7）。
- 聚焦 Redis/Worker：`pnpm --filter worker exec vitest run src/queues.spec.ts` → 4/4 passed。
- 最终 `pnpm --filter worker test` → 3 files passed, 14 tests passed。
- `pnpm --filter worker typecheck` → exit 0。
- `pnpm --filter worker build` → exit 0。
- `git diff --check` → exit 0。
