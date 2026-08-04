# 驾驶舱内小红书登录与真实数据采集 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在本机驾驶舱内展示真实小红书创作服务平台二维码，扫码后自动验证登录，并把本人账号可见的笔记、指标、全部可访问评论与回复以 `self-scrape` 来源幂等写入现有看板。

**Architecture:** Local Collector 独占持久 Playwright profile，只向本机 API 提供短时二维码、允许列表状态与版本化采集事件；API/BFF 负责鉴权、限流式轮询和动作转发，浏览器永远拿不到 Collector token 或小红书认证材料。采集结果先规范化为现有 JSONL 合同并由 Worker 复用导入语义，评论与回复通过单独的版本化合同追加写入，随后触发现有报表重建和通知链路。

**Tech Stack:** TypeScript、Node.js HTTP、Playwright、NestJS、Next.js/React、Prisma/PostgreSQL、BullMQ、Vitest、Testing Library。

## Global Constraints

- 数据源固定为 `self-scrape`；现有 `mock`、`official` connector 和离线 JSONL CLI 行为保持不变。
- Collector 只监听 `127.0.0.1`，要求至少 32 字节 Bearer token，profile 目录权限为 `0700`。
- Cookie、localStorage、验证码、手机号、浏览器 profile、二维码原图和原始认证响应不得进入数据库、应用日志、审计、通知或 Git。
- 二维码只保存在 Collector 内存，返回 `image/png`、`Cache-Control: no-store`，且受 TTL、像素和字节上限约束。
- 登录状态只能是 `idle | launching | awaiting_scan | authenticated | verification_required | expired | closed | error`，不得由“用户确认”伪造认证成功。
- 仅采集本人登录后创作服务平台正常展示或该浏览器会话正常收到的数据；不猜测私有 endpoint，不绕过 CAPTCHA、风控、设备验证或访问控制。
- `views` 未明确提供时写为 `availability=not_provided,value=null`；累计值使用 `cumulative_delta`、`authoritativePeriod=false`、空窗口。
- 评论只有遍历到平台明确终点时才标记 `page_complete`；重复游标、结构变化、验证、超时分别标记 `unverifiable`、`authorization_required` 或 `failed`。
- 每个任务先写失败测试，再做最小实现，测试通过后单独提交并执行 `git push origin HEAD:main`；不得暂存 `.superpowers/sdd/2026-08-02-xiaohongshu-dashboard-implementation/task-5-report.md`。

---

## File Structure

- `apps/collector/src/session-manager.ts`: 持有 Playwright 页面、真实认证检测、二维码快照生命周期。
- `apps/collector/src/xhs-page-adapter.ts`: 创作服务平台 DOM/响应的允许列表解析与分页终点判断。
- `apps/collector/src/collection-run.ts`: 串联账号、笔记、指标、评论、回复采集并输出脱敏进度。
- `apps/collector/src/server.ts`: Collector 的认证 HTTP 路由、PNG 响应和采集动作。
- `apps/api/src/local-collector/*`: 服务端 Collector 客户端、响应校验、二维码流式代理和同步动作。
- `apps/web/app/api/control/local-collector/*`: 受管理员 session/CSRF/Origin 保护的 BFF 路由。
- `apps/web/components/self-import-login.tsx`: 内嵌二维码、倒计时、自动轮询、验证提示和同步进度 UI。
- `packages/self-scrape-import/src/collection-schema.ts`: 版本化笔记、指标、评论、回复采集事件合同。
- `apps/worker/src/import/self-scrape-collection.service.ts`: 复用笔记/指标导入语义并幂等写入评论完整度。
- `apps/worker/src/sync/self-scrape-sync.*`: 执行采集导入、进度、报表重建与通知。

### Task 1: 真实登录状态机与短时二维码

**Files:**
- Modify: `apps/collector/src/session-manager.ts`
- Modify: `apps/collector/src/session-manager.spec.ts`
- Create: `apps/collector/src/xhs-page-adapter.ts`
- Create: `apps/collector/src/xhs-page-adapter.spec.ts`

**Interfaces:**
- Produces: `SessionState`, `SessionStatus`, `QrSnapshot`, `XhsPageAdapter.detectLoginState(page)`, `XhsPageAdapter.captureQr(page)`。
- `QrSnapshot` 为 `{ bytes: Buffer; contentType: 'image/png'; expiresAt: string; etag: string }`，只存在内存。

- [ ] **Step 1: 写失败测试，锁定真实状态与隐私边界**

```ts
it('reports authenticated only when the creator page proves login', async () => {
  adapter.detectLoginState.mockResolvedValue('authenticated');
  await manager.start();
  await expect(manager.refresh()).resolves.toMatchObject({ state: 'authenticated' });
  expect(JSON.stringify(manager.status())).not.toMatch(/cookie|storage|profile|phone/i);
});

it('expires and destroys the QR snapshot', async () => {
  clock.setSystemTime('2026-08-04T00:00:00.000Z');
  adapter.captureQr.mockResolvedValue(Buffer.from(validPng));
  await manager.start();
  expect(manager.qr().contentType).toBe('image/png');
  clock.setSystemTime('2026-08-04T00:02:01.000Z');
  expect(() => manager.qr()).toThrow('collector_qr_expired');
});
```

- [ ] **Step 2: 运行测试并确认失败**

Run: `pnpm --filter collector test -- session-manager.spec.ts xhs-page-adapter.spec.ts`
Expected: FAIL，缺少 `refresh`、`qr` 和 `XhsPageAdapter`。

- [ ] **Step 3: 实现最小状态机与页面适配器**

```ts
export type SessionState = 'idle' | 'launching' | 'awaiting_scan' | 'authenticated' |
  'verification_required' | 'expired' | 'closed' | 'error';
export interface SessionStatus {
  state: SessionState;
  changedAt: string;
  qrExpiresAt?: string;
  errorCode?: 'collector_launch_failed' | 'collector_page_changed';
}
export interface QrSnapshot {
  bytes: Buffer;
  contentType: 'image/png';
  expiresAt: string;
  etag: string;
}
```

实现 `refresh()` 调用适配器判定真实页面状态；`captureQr()` 只允许截取登录二维码容器，验证 PNG magic bytes、宽高不超过 `1024x1024`、字节不超过 `1 MiB`，TTL 120 秒。进入 `authenticated/expired/closed/error` 时将内存 Buffer 填零并清空。默认打开 `https://creator.xiaohongshu.com/`，删除 `confirm()` 与 `user_confirmed`。

- [ ] **Step 4: 运行 Collector 单测**

Run: `pnpm --filter collector test -- session-manager.spec.ts xhs-page-adapter.spec.ts`
Expected: PASS；测试断言二维码过期、并发 start 幂等、验证状态与 profile `0700`。

- [ ] **Step 5: 提交并推送**

```bash
git add apps/collector/src/session-manager.ts apps/collector/src/session-manager.spec.ts apps/collector/src/xhs-page-adapter.ts apps/collector/src/xhs-page-adapter.spec.ts
git commit -m "feat: detect xhs login and capture ephemeral qr"
git push origin HEAD:main
```

### Task 2: Collector 二维码与采集控制 HTTP 协议

**Files:**
- Modify: `apps/collector/src/server.ts`
- Modify: `apps/collector/src/server.spec.ts`
- Create: `apps/collector/src/collection-run.ts`
- Create: `apps/collector/src/collection-run.spec.ts`

**Interfaces:**
- Consumes: Task 1 的 `manager.refresh()`、`manager.qr()`、`manager.start()`、`manager.close()`。
- Produces: `GET /v1/session/qr`、`POST /v1/session/refresh`、`POST /v1/collection/start`、`GET /v1/collection/status`。
- `CollectionStatus` 为 `{ runId; state; stage; processed; total; incompleteNotes; changedAt; errorCode? }`。

- [ ] **Step 1: 写失败的协议测试**

```ts
expect(await callRaw(port, 'GET', '/v1/session/qr', token)).toMatchObject({
  status: 200,
  headers: { 'content-type': 'image/png', 'cache-control': 'no-store' },
  body: validPng,
});
expect(await call(port, 'POST', '/v1/session/confirm', token)).toMatchObject({ status: 404 });
expect(await call(port, 'POST', '/v1/collection/start', token)).toMatchObject({
  status: 202, body: { state: 'running', stage: 'account' },
});
```

- [ ] **Step 2: 运行并确认失败**

Run: `pnpm --filter collector test -- server.spec.ts collection-run.spec.ts`
Expected: FAIL，二维码、refresh 和 collection 路由尚不存在。

- [ ] **Step 3: 实现固定允许列表路由和单运行器**

JSON 响应继续使用固定字段校验；PNG 路由覆盖默认 JSON content-type，添加 `Content-Length`、`ETag`、`Expires` 和 `X-Content-Type-Options: nosniff`。`CollectionRun` 同时只允许一个 run，状态阶段固定为 `account | notes | metrics | comments | replies | writing | reports | complete`，错误只映射为允许列表错误码，不包含 selector、URL、响应正文或认证信息。

- [ ] **Step 4: 运行 Collector 全套测试与类型检查**

Run: `pnpm --filter collector test && pnpm --filter collector typecheck`
Expected: 全部 PASS。

- [ ] **Step 5: 提交并推送**

```bash
git add apps/collector/src/server.ts apps/collector/src/server.spec.ts apps/collector/src/collection-run.ts apps/collector/src/collection-run.spec.ts
git commit -m "feat: expose protected qr and collection controls"
git push origin HEAD:main
```

### Task 3: API 端安全代理与严格响应校验

**Files:**
- Modify: `apps/api/src/local-collector/local-collector.service.ts`
- Modify: `apps/api/src/local-collector/local-collector.service.spec.ts`
- Modify: `apps/api/src/local-collector/local-collector.controller.ts`
- Create: `apps/api/src/local-collector/local-collector.controller.spec.ts`

**Interfaces:**
- Consumes: Task 2 的 Collector HTTP 协议。
- Produces: `GET /local-collector/qr`、`POST /local-collector/refresh`、`POST /local-collector/sync`、`GET /local-collector/sync-status`。
- `qr(): Promise<{ bytes: Uint8Array; etag: string; expires: string }>` 只接受受限 PNG。

- [ ] **Step 1: 写失败测试覆盖恶意上游响应**

```ts
it.each([
  ['text/html', validPng, 'collector_qr_content_type_invalid'],
  ['image/png', Buffer.alloc(1_048_577), 'collector_qr_too_large'],
  ['image/png', Buffer.from('<html>'), 'collector_qr_invalid'],
])('rejects invalid QR responses', async (type, body, code) => {
  fetcher.mockResolvedValue(new Response(body, { headers: { 'content-type': type } }));
  await expect(service.qr()).rejects.toThrow(code);
});
```

- [ ] **Step 2: 运行并确认失败**

Run: `pnpm --filter api test -- local-collector.service.spec.ts local-collector.controller.spec.ts`
Expected: FAIL，`qr`、新动作和控制器 PNG 响应未实现。

- [ ] **Step 3: 实现 API 服务与控制器**

将状态校验允许值切换为新状态机，移除 `confirm`。`qr()` 使用 5 秒超时，要求 `image/png`、1 MiB 上限、PNG magic bytes、合法 `ETag/Expires`；控制器通过 Nest response 发送二进制并设置 `private, no-store, max-age=0`。所有端点保留 `AuthGuard`，Collector token 仅由服务端环境变量读取。

- [ ] **Step 4: 运行 API 全套测试与类型检查**

Run: `pnpm --filter api test && pnpm --filter api test:e2e && pnpm --filter api typecheck`
Expected: 全部 PASS，旧 auth/dashboard e2e 不回归。

- [ ] **Step 5: 提交并推送**

```bash
git add apps/api/src/local-collector
git commit -m "feat: proxy local xhs qr and sync status"
git push origin HEAD:main
```

### Task 4: 驾驶舱内二维码、倒计时与自动登录验证

**Files:**
- Modify: `apps/web/app/api/control/local-collector/[action]/route.ts`
- Create: `apps/web/app/api/control/local-collector/qr/route.ts`
- Create: `apps/web/app/api/control/local-collector/qr/route.spec.ts`
- Modify: `apps/web/components/self-import-login.tsx`
- Create: `apps/web/components/self-import-login.spec.tsx`
- Modify: `apps/web/app/globals.css`
- Modify: `apps/web/app/(dashboard)/accounts/page.tsx`

**Interfaces:**
- Consumes: Task 3 API 端点。
- Produces: 页面内扫码卡片；客户端只请求同源 `/api/control/local-collector/*`。

- [ ] **Step 1: 写失败的 BFF 与组件测试**

```tsx
render(<SelfImportLogin />);
await user.click(screen.getByRole('button', { name: '在驾驶舱登录小红书' }));
expect(await screen.findByRole('img', { name: '小红书登录二维码' })).toHaveAttribute(
  'src', expect.stringMatching(/^\/api\/control\/local-collector\/qr\?v=/),
);
serverStatus.state = 'authenticated';
await waitFor(() => expect(screen.getByText('账号已连接')).toBeVisible());
expect(screen.queryByRole('button', { name: '我已扫码完成' })).not.toBeInTheDocument();
```

- [ ] **Step 2: 运行并确认失败**

Run: `pnpm --filter web test -- self-import-login.spec.tsx qr/route.spec.ts`
Expected: FAIL，页面仍打开外部 Chrome 且存在人工确认按钮。

- [ ] **Step 3: 实现同源 PNG BFF 与响应式 UI**

二维码 BFF 仅转发已认证 API 返回的 PNG/ETag/Expires，不读取请求 URL 参数作为上游地址。组件每 2 秒轮询，按 `qrExpiresAt` 显示倒计时；过期后调用 `refresh` 并用新的版本 query 刷新图像；`verification_required` 显示“请在本机验证窗口完成平台验证”，不提供自动绕过。认证后显示“立即同步”，同步中展示八个固定阶段及处理计数。

- [ ] **Step 4: 运行 Web 测试、类型检查与构建**

Run: `pnpm --filter web test && pnpm --filter web typecheck && pnpm --filter web build`
Expected: 全部 PASS；手机宽度 390px 不横向溢出。

- [ ] **Step 5: 提交并推送**

```bash
git add apps/web/app/api/control/local-collector apps/web/components/self-import-login.tsx apps/web/components/self-import-login.spec.tsx apps/web/app/globals.css 'apps/web/app/(dashboard)/accounts/page.tsx'
git commit -m "feat: show real xhs qr inside dashboard"
git push origin HEAD:main
```

### Task 5: 版本化采集合同与创作中心分页适配器

**Files:**
- Create: `packages/self-scrape-import/src/collection-schema.ts`
- Create: `packages/self-scrape-import/src/collection-schema.spec.ts`
- Modify: `packages/self-scrape-import/src/index.ts`
- Modify: `apps/collector/src/xhs-page-adapter.ts`
- Modify: `apps/collector/src/xhs-page-adapter.spec.ts`
- Modify: `apps/collector/src/collection-run.ts`
- Modify: `apps/collector/src/collection-run.spec.ts`

**Interfaces:**
- Produces: `SelfScrapeCollectionEventV1` 的 `account | note | metric | comment | completeness | completed` 判别联合。
- 评论字段：`platformId,noteId,parentPlatformId,content,publishedAt,likeCount,source:'self-scrape'`。

- [ ] **Step 1: 写失败合同与分页终点测试**

```ts
expect(normalizeCollectionEvent({
  version: 1, type: 'comment', source: 'self-scrape', runId,
  comment: { platformId: 'c1', noteId: 'n1', parentPlatformId: null,
    content: '内容', publishedAt: '2026-08-03T10:00:00+08:00', likeCount: 2 },
})).toMatchObject({ type: 'comment', comment: { likeCount: 2 } });
expect(() => normalizeCollectionEvent({ ...event, cookie: 'secret' })).toThrow('unknown_field');
expect(pager.next({ cursor: 'a', hasMore: false })).toEqual({ done: true });
expect(() => pager.next({ cursor: 'a', hasMore: true })).toThrow('repeated_cursor');
```

- [ ] **Step 2: 运行并确认失败**

Run: `pnpm --filter @xhs/self-scrape-import test && pnpm --filter collector test -- xhs-page-adapter.spec.ts collection-run.spec.ts`
Expected: FAIL，采集事件合同和分页保护不存在。

- [ ] **Step 3: 实现严格合同与采集遍历**

合同使用 strict object、长度上限、安全整数、带时区时间戳和 `source==='self-scrape'`；不扩展 `@xhs/connector` 的 `official | mock` 接口。适配器依次采集账号、全部笔记、可见累计指标、每条笔记全部一级评论及每条评论全部回复；每页要求平台 ID，跟踪 seen cursors，只有 `hasMore=false` 或页面明确“没有更多”才输出 `page_complete`。无法确认阅读量时输出 `views_available:false,views:0`，供既有规范化器转换为 null。

- [ ] **Step 4: 运行合同、Collector 测试和类型检查**

Run: `pnpm --filter @xhs/self-scrape-import test && pnpm --filter @xhs/self-scrape-import typecheck && pnpm --filter collector test && pnpm --filter collector typecheck`
Expected: 全部 PASS；fixture 覆盖回复分页、重复游标、结构变化、验证中断和空评论终点。

- [ ] **Step 5: 提交并推送**

```bash
git add packages/self-scrape-import/src apps/collector/src
git commit -m "feat: collect visible xhs notes metrics and comments"
git push origin HEAD:main
```

### Task 6: 幂等导入笔记、指标、评论和完整度

**Files:**
- Create: `apps/worker/src/import/self-scrape-collection.service.ts`
- Create: `apps/worker/src/import/self-scrape-collection.service.spec.ts`
- Modify: `apps/worker/src/import/self-scrape-import.service.ts`
- Modify: `apps/worker/src/import/self-scrape-import.service.spec.ts`
- Modify: `packages/database/src/comment.repository.integration.spec.ts`

**Interfaces:**
- Consumes: Task 5 的 `SelfScrapeCollectionEventV1`。
- Produces: `importSelfScrapeCollection(stream, { db, runId }) -> { accountId, notesChanged, snapshotsChanged, commentsChanged, incompleteNotes, sha256 }`。

- [ ] **Step 1: 写失败的幂等与 revision 测试**

```ts
const first = await importSelfScrapeCollection(stream(events), { db, runId: 'run-1' });
const second = await importSelfScrapeCollection(stream(events), { db, runId: 'run-2' });
expect(first).toMatchObject({ notesChanged: 1, snapshotsChanged: 3, commentsChanged: 2 });
expect(second).toMatchObject({ notesChanged: 0, snapshotsChanged: 0, commentsChanged: 0 });
expect(await db.comment.findMany({ orderBy: { platformId: 'asc' } })).toMatchObject([
  { platformId: 'c1', parentPlatformId: null, likeCount: 2 },
  { platformId: 'r1', parentPlatformId: 'c1', likeCount: 1 },
]);
```

- [ ] **Step 2: 运行并确认失败**

Run: `pnpm --filter worker test -- self-scrape-collection.service.spec.ts self-scrape-import.service.spec.ts`
Expected: FAIL，新服务不存在。

- [ ] **Step 3: 提取并复用现有提交语义**

把 `commitRecord` 提取为可复用导出，但保持 CLI 的参数和摘要不变。采集导入先写临时 `0600` JSONL 并计算 SHA-256，再调用同一笔记/指标提交函数；评论以 `(connectorType,platformId)` upsert，更新 `content,publishedAt,likeCount,lastSeenAt` 并保留 `firstSeenAt`，回复保留 `parentPlatformId`。每条笔记的 completeness 必须由该 run 的终止事件决定，缺失终止事件默认 `unverifiable`。审计仅存 run ID、hash、计数和固定错误码。

- [ ] **Step 4: 运行 Worker 单测与数据库集成测试**

Run: `pnpm --filter worker test && pnpm --filter @xhs/database test && pnpm --filter worker typecheck`
Expected: 全部 PASS；重跑 no-op、指标变化追加 revision、评论变化更新、partial 不冒充 complete。

- [ ] **Step 5: 提交并推送**

```bash
git add apps/worker/src/import packages/database/src/comment.repository.integration.spec.ts
git commit -m "feat: import collected xhs data idempotently"
git push origin HEAD:main
```

### Task 7: 同步任务、滚动日期、报表重建与通知

**Files:**
- Create: `apps/worker/src/sync/self-scrape-sync.service.ts`
- Create: `apps/worker/src/sync/self-scrape-sync.service.spec.ts`
- Create: `apps/worker/src/sync/self-scrape-sync.processor.ts`
- Create: `apps/worker/src/sync/self-scrape-sync.processor.spec.ts`
- Modify: `apps/worker/src/queues.ts`
- Modify: `apps/worker/src/worker.module.ts`
- Modify: `apps/worker/src/notifications/event-producers.ts`
- Create: `apps/worker/src/notifications/event-producers.spec.ts`
- Modify: `apps/api/src/local-collector/local-collector.service.ts`
- Modify: `apps/api/src/local-collector/local-collector.controller.ts`

**Interfaces:**
- Consumes: Task 2 采集运行、Task 6 导入服务、现有 backfill/report/notification outbox。
- Produces: 用户点击“立即同步”可启动一个 `self-scrape` run；成功、部分完成、登录失效和失败事件。

- [ ] **Step 1: 写失败的日期与通知测试**

```ts
expect(await service.run({ now: '2026-08-03T09:00:00+08:00' })).toMatchObject({
  businessDates: ['2026-08-01', '2026-08-02'], source: 'self-scrape',
});
expect(await service.run({ now: '2026-08-04T09:00:00+08:00' })).toMatchObject({
  businessDates: ['2026-08-01', '2026-08-02', '2026-08-03'],
});
expect(publisher.publish).toHaveBeenCalledWith(expect.objectContaining({ type: 'sync.partial' }));
```

- [ ] **Step 2: 运行并确认失败**

Run: `pnpm --filter worker test -- self-scrape-sync.service.spec.ts self-scrape-sync.processor.spec.ts event-producers.spec.ts`
Expected: FAIL，self-scrape 同步处理器尚不存在。

- [ ] **Step 3: 实现本月已结束日期补采与后续处理**

以 Asia/Shanghai 计算当月 1 日到昨天的 `businessDates`，查询现有快照识别缺失日并允许重复采集修订；周日继续由现有周报规则消费当周范围，月末或次月首日由现有月报最终汇总消费上月范围。导入产生的 BackfillEvent 使用 `source:'self-scrape'`，交给现有 pending dispatcher 重建日报、周报、月报。运行结果按 `complete/partial/authentication_required/failed` 发布脱敏通知，任务 payload 保存阶段计数而非原始内容。

- [ ] **Step 4: 运行 Worker/API 回归测试**

Run: `pnpm --filter worker test && pnpm --filter api test && pnpm --filter worker typecheck && pnpm --filter api typecheck`
Expected: 全部 PASS；既有 official rolling scheduler 测试不变。

- [ ] **Step 5: 提交并推送**

```bash
git add apps/worker/src apps/api/src/local-collector
git commit -m "feat: schedule self scrape sync and notifications"
git push origin HEAD:main
```

### Task 8: 全链路验收、隐私扫描与运行文档

**Files:**
- Create: `apps/api/test/local-collector.e2e-spec.ts`
- Create: `docs/LOCAL_XHS_COLLECTOR.md`
- Modify: `.env.example`
- Modify: `README.md`

**Interfaces:**
- Consumes: Tasks 1-7 全部接口。
- Produces: 可重复的本机启动、扫码、同步和故障恢复说明。

- [ ] **Step 1: 写失败的 E2E 场景**

```ts
it('starts login, proxies a no-store QR, authenticates and starts one sync', async () => {
  await admin.post('/local-collector/start').expect(200).expect(({ body }) =>
    expect(body.state).toBe('awaiting_scan'));
  await admin.get('/local-collector/qr').expect('content-type', /image\/png/)
    .expect('cache-control', /no-store/).expect(200);
  await admin.post('/local-collector/sync').expect(202);
  await admin.post('/local-collector/sync').expect(200).expect(({ body }) =>
    expect(body.runId).toBe(existingRunId));
});
```

- [ ] **Step 2: 运行并确认失败**

Run: `pnpm --filter api test:e2e -- local-collector.e2e-spec.ts`
Expected: FAIL，测试 fixture 和完整 E2E 断言尚未就绪。

- [ ] **Step 3: 完成运行说明与安全 fixture**

文档只列出变量名，不写真实 token：`LOCAL_XHS_COLLECTOR_ENABLED=true`、`LOCAL_XHS_COLLECTOR_HOST=127.0.0.1`、`LOCAL_XHS_COLLECTOR_PORT=43127`、`LOCAL_XHS_COLLECTOR_TOKEN=<random-48-plus-chars>`、`LOCAL_XHS_PROFILE_DIR=<private-local-directory>`。说明真实限制、用户验证步骤、二维码过期恢复、登录失效重扫和 profile 清除的二次确认要求。

- [ ] **Step 4: 执行完整验证与隐私扫描**

Run: `pnpm test && pnpm typecheck && pnpm build`
Expected: 全部 PASS。

Run: `rg -n -i 'cookie|localstorage|authorization:|xhs.*token|qr.*base64' apps packages docs --glob '!**/*.spec.ts' --glob '!docs/superpowers/**'`
Expected: 仅出现安全校验、环境变量名和禁止存储说明；人工逐项确认不存在凭据值、二维码数据或原始响应落库/日志代码。

- [ ] **Step 5: 本机真实烟雾测试**

Run: 启动 PostgreSQL/Redis、Collector、API、Web；访问 `http://127.0.0.1:3000/accounts`，在页面内扫码，确认状态自动变为“账号已连接”，点击“立即同步”，等待阶段到 `complete`。
Expected: 至少一条本人笔记和可见点赞/评论指标出现；评论页显示全部可访问一级评论与回复及可信完整度；日志与数据库抽查不含 Cookie/localStorage/二维码。

- [ ] **Step 6: 最终提交并推送**

```bash
git add apps/api/test/local-collector.e2e-spec.ts docs/LOCAL_XHS_COLLECTOR.md .env.example README.md
git commit -m "docs: verify local xhs login and collection"
git push origin HEAD:main
```

## Final Verification Checklist

- [ ] 账号页内展示真实、短时、不可缓存二维码，用户无需切到外部 Chrome 查看二维码。
- [ ] Collector 从创作中心页面自行确认 `authenticated`，不存在人工确认成功路径。
- [ ] 同步至少一条本人真实笔记及其可见 `views/likes/comments`，缺失 views 为 `not_provided + null`。
- [ ] 一级评论与回复遍历到明确终点才标记 `page_complete`，重跑不重复。
- [ ] 指标变化产生 append-only revision；报表只消费对应 source，mock/official/离线导入不回归。
- [ ] 2026-08-03 覆盖 8 月 1-2 日，2026-08-04 覆盖 8 月 1-3 日；周日和月底汇总复用现有 Asia/Shanghai 规则。
- [ ] 同步成功、部分完成、登录失效、失败均产生及时通知。
- [ ] Cookie、localStorage、二维码、验证码、手机号、原始响应未进入日志、数据库、通知或 Git。
