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

## Fix round 1

### RED

- 模块启动测试最初因 `AdminGuard` 不存在而失败；Push policy 测试最初因策略模块不存在而失败。
- 永久失效订阅删除、暂时错误保留、必需 payload ID 与恶意路径编码测试在旧实现上失败。
- `NotificationPublisher` 测试最初因模块不存在而失败；sync/report producer 测试最初观察不到任何通知事件。
- API Prisma 集成测试覆盖管理员全量列表、已读持久化、有效账号订阅及不存在账号拒绝。

### GREEN

- `NotificationsStore` 使用显式 DI token 和 concrete Prisma provider；Notifications controller 使用可由 Task 8 扩展的 `AdminGuard`，真实 AppModule application context 启动成功。
- Push 接收端和发送端均执行可配置 host suffix allowlist，拒绝 userinfo、非 443、localhost、private/link-local IPv4/IPv6；`web-push` 不跟随重定向。
- Gateway 返回 `delivered`、`gone`、`retryable_failure`；404/410 按 accountId+endpoint 删除，5xx/网络错误保留，任何 Push 结果均不改变站内事实或业务任务结果。
- 七类事件均校验目标 ID；动态路由段使用 `encodeURIComponent`。新增 `0008_notification_type_check`，先规范化 legacy type 再添加七类值 CHECK。
- 新增 best-effort `NotificationPublisher` 并接入 sync 完成/失败/授权失效、新评论、评论不完整，以及报告生成/重建的真实 service/processor 边界；队列错误仅记录不含敏感 payload 的结构化元数据。

### 覆盖文件

- API：`admin.guard.ts`、`push-endpoint.policy.ts`、notifications controller/module/service/dto 及 module/Prisma 测试。
- Worker：notification policy/gateway/service/publisher/processor，sync service，report service/processor 及对应测试。
- Database：`0008_notification_type_check/migration.sql`。

### Review 修复与最终验证

- `AdminGuard` 改为 fail-closed：只有配置 `ADMIN_API_TOKEN` 且请求 `x-admin-token` 精确匹配才放行；Task 8 可替换其认证来源。
- 新评论只在账号已有成功基线同步且数据库确认本次新建 comment 时发布，初次全量历史抓取不会触发通知。
- allowlist hostname 在接收与发送前解析全部 A/AAAA，任一目标为 loopback、private 或 link-local 即拒绝；发送仍复验原 URL policy。
- Worker DB spec 改为文件串行，消除共享 PostgreSQL 清理造成的跨文件竞态。
- 最终：Worker 11 files / 64 tests，API 5 files / 9 tests；两端 typecheck/build、database typecheck、PG18 migrate status 与 diff check 全部通过。
