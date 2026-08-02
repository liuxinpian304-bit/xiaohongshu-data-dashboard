# Task 7 实施报告：通知事件与 Web Push

## 交付内容

- 固定支持 `sync_completed`、`sync_failed`、`authorization_expired`、`new_comment`、`comment_sync_incomplete`、`report_generated`、`report_rebuilt` 七类事件，并生成对应站内标题、正文和目标链接。
- `Notification.eventId` 数据库唯一约束与 `PrismaNotificationRepository.createOnce` 共同保证重复及并发投递幂等。
- 站内通知先落库；订阅读取或 Push 投递失败通过隔离处理，不影响事件处理任务成功。
- 新增通知列表、标记已读、保存 Push subscription 三个 API；订阅 endpoint、p256dh、auth 在入库前校验，代码不记录这些敏感字段。
- Worker 新增通知队列处理器并纳入统一启动/关闭生命周期。
- 新增 `0006_notifications_push` 与 `0007_scope_push_subscriptions` 迁移，扩充通知事实字段、创建 PushSubscription，并以 Account 外键隔离订阅。

## RED

- `pnpm --filter worker test -- notification.service.spec.ts`：失败，原因是 `./notification.service` 不存在，符合预期。
- `pnpm --filter api test -- notifications.service.spec.ts`：失败，原因是 `./notifications.service` 不存在，符合预期。
- 增强订阅校验测试要求非法 subscription 抛 `BadRequestException`：实现初始仅抛普通 `Error`，测试正确失败。

## GREEN

- Worker 单元/集成测试：9 files、52 tests 全部通过；其中双独立连接并发投递同 eventId 的真实 PostgreSQL 测试确认只生成一条事实记录。
- API 测试：2 files、5 tests 全部通过；已读时间可持久化，非法订阅/畸形 URL 返回 400 语义，合法订阅按账号规范化保存。
- `prisma migrate deploy`：`0006_notifications_push` 与 `0007_scope_push_subscriptions` 在本地 PostgreSQL 成功应用。
- Worker/API typecheck 与 build 均成功。

## 自检

- Push 调用没有位于数据库事务中，也不会反向更改站内通知事实。
- 重复事件不会重复 Web Push；首次 Push 失败不会抛出到业务任务。
- 没有日志输出 subscription endpoint、auth 或 p256dh。
- 生产 Worker 注入 `WebPushGateway`；VAPID 缺失或外部发送失败仍被通知服务隔离。
- PushSubscription 通过 Account 外键归属账号，查询不会跨账号返回订阅。
- 未包含工作区中既有的 Task 5 报告改动。
