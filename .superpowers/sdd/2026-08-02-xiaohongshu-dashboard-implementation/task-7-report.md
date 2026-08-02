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

## Fix round 2

### RED

- AdminGuard 测试覆盖 missing、错误前缀、同长度错误和正确 token；旧实现仍使用普通字符串比较。
- 共享 Push policy 测试最初因模块不存在失败，并明确覆盖 `fe90::1`、`::ffff:127.0.0.1`、`::`、`::1`、`fc00::1`、`fd12::1` 及私有 IPv4。
- DNS rebinding 测试模拟首次解析公共地址、潜在第二次解析 loopback，要求 pinned agent 不再调用 resolver。
- 两个独立 PrismaClient 并发保存同一 comment 时，旧 pre-read+upsert 实际返回 `[1,1]`，证明会双报 created。

### GREEN

- Admin token 统一 UTF-8 Buffer 编码；仅等长时使用 `crypto.timingSafeEqual`，缺失或长度不同安全失败。
- API 与 Worker 删除各自 policy，统一使用 `@xhs/domain` 的 `PushEndpointPolicy`；默认 allowlist 固定为明确 Web Push provider，不读取任意环境 suffix。
- policy 完整拒绝非全局 IPv4/IPv6（含 IPv4-mapped 特殊地址），解析后创建 HTTPS Agent，其 lookup 永远只返回已验证 public IP；原 endpoint hostname 保持 TLS SNI 与证书校验，web-push 单请求不跟随 redirect。
- comment 保存改为 PostgreSQL 批量 `INSERT ... ON CONFLICT DO NOTHING RETURNING`，created 只来自本事务实际插入行，再单独更新 mutable fields；双连接并发测试为 `[0,1]` 且总行数 1。

### 覆盖文件

- `packages/domain/src/push-endpoint-policy.ts` 及测试、domain exports/dependencies。
- API AdminGuard 测试与共享 policy 接入；Worker WebPushGateway pinned agent 接入。
- `SyncRepository.saveCommentsPage` 与 `sync.repository.comment.integration.spec.ts`。

## Fix round 3：Pinned lookup 契约

### RED 证据

命令：

```bash
pnpm --filter @xhs/domain exec vitest run src/push-endpoint-policy.spec.ts
```

失败输出：

```text
src/push-endpoint-policy.spec.ts (10 tests | 1 failed)
implements Node lookup all and family selection contracts from one pinned resolution
expected '8.8.8.8' to deeply equal [{ address: '8.8.8.8', family: 4 }, { address: '2001:4860:4860::8888', family: 6 }]
Test Files 1 failed (1)
Tests 1 failed | 9 passed (10)
```

### GREEN 证据

命令：

```bash
pnpm --filter @xhs/domain exec vitest run src/push-endpoint-policy.spec.ts
pnpm --filter @xhs/domain typecheck
```

通过输出：

```text
src/push-endpoint-policy.spec.ts (12 tests) passed
Test Files 1 passed (1)
Tests 12 passed (12)
tsc --noEmit
```

### 修复内容

- `options.all === true` 返回完整 `LookupAddress[]`；普通 lookup 返回单个 `address, family`。
- family 0 选择首个已验证地址，family 4/6 只选择匹配地址；不存在匹配 family 时返回错误，不跨族回退。
- 所有 lookup 仅消费首次预解析得到的 pinned public 地址列表，不触发第二次 DNS。
- 新增真实 `https.request` auto-family 路径测试：不再出现 `ERR_INVALID_IP_ADDRESS`，endpoint hostname 与 TLS `servername` 保持原始 `push.example.test`。

## Fix round 4：Pinned lookup all + family 契约

### RED 证据

`pnpm --filter @xhs/domain exec vitest run src/push-endpoint-policy.spec.ts` 产生 2 个预期失败：`{ all: true, family: 4 }` 错误返回 IPv4 与 IPv6 两族地址；仅有 IPv4 时 `{ all: true, family: 6 }` 错误成功而未返回明确错误。

### GREEN 证据

同一测试命令通过：1 file、12 tests。`all: true` 现在以 family 0 返回全部 pinned 地址，以 family 4/6 只返回匹配的 `LookupAddress[]`；无匹配 family 时返回包含请求族的明确错误。标量 lookup、单次 DNS 与原 hostname/SNI 路径保持原测试覆盖。

完整验证：domain 3 files / 18 tests、worker 12 files / 65 tests、api 5 files / 9 tests 全部通过；domain、worker、api typecheck 全部通过；worker 与 api build 通过。domain package 未定义 `build` script，执行对应命令明确返回 `None of the selected packages has a "build" script`，没有将其误报为成功。
