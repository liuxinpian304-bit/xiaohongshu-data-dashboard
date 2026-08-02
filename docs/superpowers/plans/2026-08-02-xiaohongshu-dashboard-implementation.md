# 小红书官方 API 数据看板实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 交付一个可运行的小红书数据看板，使用模拟官方连接器完成多账号、笔记指标、逐页评论、T+1 日报、自然周周报、自然月月报和浏览器通知全流程，并保留正式官方 API 连接器边界。

**Architecture:** pnpm monorepo 包含 Next.js Web、NestJS API 和独立 Worker。PostgreSQL 保存业务事实，Redis/BullMQ 承担同步和报告任务，所有小红书字段先经过连接器契约转换为领域模型。

**Tech Stack:** Node.js 24.14.0、pnpm 11.9.0、Next.js 16.2.12、NestJS 11.1.28、Prisma 7.9.1、PostgreSQL 18、Redis 8、BullMQ 6.0.5、TypeScript、Tailwind CSS、Apache ECharts、Vitest、Playwright、Docker Compose。

## Global Constraints

- 只接入小红书官方开放平台明确授权的接口和数据。
- 不使用网页 Cookie、浏览器自动化、隐藏接口、验证码绕过、风控规避或真人行为伪装。
- 正式官方 API 未获批前，所有演示数据必须标记为 `mock`，不得显示为正式数据。
- 业务时区固定为 `Asia/Shanghai`，数据库时间戳使用 UTC。
- 日报每天生成昨天自然日；周报每周一生成上周一至周日；月报每月 1 日生成上月。
- 数据可用性必须区分 `zero`、`not_synced`、`awaiting_authorization`、`not_provided`。
- 评论完成只表示官方分页游标消费完毕，不宣称包含官方未返回内容。
- 正式凭证不得进入前端、日志、测试快照或版本库。
- 每个任务执行 RED、GREEN、REFACTOR，测试通过后单独提交。

## 文件结构

```text
.
├── apps/
│   ├── web/                         # Next.js 管理后台
│   ├── api/                         # NestJS REST API
│   └── worker/                      # BullMQ 消费者和周期调度
├── packages/
│   ├── database/                    # Prisma schema、迁移、client
│   ├── domain/                      # 领域类型、报告周期、聚合规则
│   ├── connector/                   # 官方连接器契约与 mock 实现
│   └── shared/                      # 环境校验、DTO、公共工具
├── tests/e2e/                       # Playwright 全流程测试
├── docker-compose.yml
├── pnpm-workspace.yaml
└── package.json
```

---

### Task 1: Monorepo 与可启动健康检查

**Files:**
- Create: `package.json`
- Create: `pnpm-workspace.yaml`
- Create: `tsconfig.base.json`
- Create: `.gitignore`
- Create: `.env.example`
- Create: `apps/web/package.json`
- Create: `apps/web/app/page.tsx`
- Create: `apps/web/app/layout.tsx`
- Create: `apps/web/app/globals.css`
- Create: `apps/api/package.json`
- Create: `apps/api/src/main.ts`
- Create: `apps/api/src/app.module.ts`
- Create: `apps/api/src/health.controller.ts`
- Create: `apps/api/src/health.controller.spec.ts`
- Create: `apps/worker/package.json`
- Create: `apps/worker/src/main.ts`

**Interfaces:**
- Produces: `GET /health -> { status: "ok" }`
- Produces: workspace scripts `dev`, `build`, `test`, `lint`, `typecheck`

- [ ] **Step 1: 写健康检查失败测试**

```ts
describe('HealthController', () => {
  it('returns ok', () => {
    expect(new HealthController().getHealth()).toEqual({ status: 'ok' });
  });
});
```

- [ ] **Step 2: 安装依赖并确认测试因缺少实现失败**

Run: `pnpm install && pnpm --filter api test -- health.controller.spec.ts`

Expected: FAIL，提示 `HealthController` 或 `getHealth` 不存在。

- [ ] **Step 3: 实现最小 API、Web 和 Worker 启动点**

```ts
@Controller('health')
export class HealthController {
  @Get()
  getHealth() {
    return { status: 'ok' as const };
  }
}
```

Web 首页显示“数据驾驶舱”和“演示模式”；Worker 启动后输出结构化启动日志，不包含敏感环境变量。

- [ ] **Step 4: 验证工作区**

Run: `pnpm test && pnpm typecheck && pnpm build`

Expected: 全部退出码为 0，三个应用均能构建。

- [ ] **Step 5: 提交**

```bash
git add package.json pnpm-workspace.yaml tsconfig.base.json .gitignore .env.example apps
git commit -m "build: scaffold dashboard monorepo"
```

---

### Task 2: 领域模型与报告时间范围

**Files:**
- Create: `packages/domain/package.json`
- Create: `packages/domain/src/index.ts`
- Create: `packages/domain/src/data-availability.ts`
- Create: `packages/domain/src/report-period.ts`
- Create: `packages/domain/src/report-period.spec.ts`
- Create: `packages/domain/src/metric.ts`
- Create: `packages/domain/src/comment.ts`
- Create: `packages/domain/src/sync-job.ts`

**Interfaces:**
- Produces: `getReportPeriod(type: ReportType, now: Date): ReportPeriod`
- Produces: `DataAvailability = 'zero' | 'not_synced' | 'awaiting_authorization' | 'not_provided' | 'available'`
- Produces: `CommentCompleteness = 'syncing' | 'page_complete' | 'awaiting_authorization' | 'not_provided' | 'sync_error' | 'unverifiable'`

- [ ] **Step 1: 写上海时区边界失败测试**

```ts
it('builds Monday weekly report for the previous natural week', () => {
  const period = getReportPeriod('weekly', new Date('2026-08-03T01:00:00+08:00'));
  expect(period).toEqual({
    type: 'weekly',
    start: new Date('2026-07-27T00:00:00+08:00'),
    end: new Date('2026-08-02T23:59:59.999+08:00'),
    label: '2026年第31周',
  });
});
```

同时覆盖日报、月报、跨年周、闰年二月。

- [ ] **Step 2: 运行并确认失败**

Run: `pnpm --filter @xhs/domain test`

Expected: FAIL，提示 `getReportPeriod` 不存在。

- [ ] **Step 3: 使用 `date-fns` 与 `date-fns-tz` 实现固定上海时区算法**

```ts
export type ReportType = 'daily' | 'weekly' | 'monthly';
export interface ReportPeriod {
  type: ReportType;
  start: Date;
  end: Date;
  label: string;
}
export function getReportPeriod(type: ReportType, now: Date): ReportPeriod;
```

- [ ] **Step 4: 验证领域包**

Run: `pnpm --filter @xhs/domain test && pnpm --filter @xhs/domain typecheck`

Expected: 全部 PASS。

- [ ] **Step 5: 提交**

```bash
git add packages/domain
git commit -m "feat: define reporting domain rules"
```

---

### Task 3: PostgreSQL 数据模型与幂等约束

**Files:**
- Create: `packages/database/package.json`
- Create: `packages/database/prisma/schema.prisma`
- Create: `packages/database/prisma/migrations/0001_init/migration.sql`
- Create: `packages/database/src/client.ts`
- Create: `packages/database/src/index.ts`
- Create: `packages/database/src/comment.repository.ts`
- Create: `packages/database/src/comment.repository.integration.spec.ts`
- Create: `docker-compose.yml`

**Interfaces:**
- Consumes: domain enums from `@xhs/domain`
- Produces: `upsertComment(input: UpsertCommentInput): Promise<{ comment: Comment; created: boolean }>`
- Produces: unique boundary `(connectorType, platformId)` for platform objects

- [ ] **Step 1: 写重复评论集成测试**

```ts
it('upserts the same platform comment without duplication', async () => {
  const first = await repository.upsertComment(commentInput);
  const second = await repository.upsertComment({ ...commentInput, likeCount: 9 });
  expect(first.created).toBe(true);
  expect(second.created).toBe(false);
  expect(await prisma.comment.count()).toBe(1);
  expect(second.comment.likeCount).toBe(9);
});
```

- [ ] **Step 2: 启动数据库并确认测试失败**

Run: `docker compose up -d postgres redis && pnpm --filter @xhs/database test:integration`

Expected: FAIL，缺少 schema 或 repository。

- [ ] **Step 3: 定义完整 Prisma 模型**

模型必须包含 `Account`、`Credential`、`ConnectorCapability`、`Note`、`MetricDefinition`、`MetricSnapshot`、`Comment`、`SyncJob`、`SyncStep`、`Report`、`ReportMetric`、`Notification`、`AuditLog`。`Comment` 包含 `platformId`、`parentPlatformId`、`content`、`publishedAt`、`firstSeenAt`、`lastSeenAt`、`likeCount` 和 `source`。

- [ ] **Step 4: 生成客户端、执行迁移并验证**

Run: `pnpm --filter @xhs/database prisma:generate && pnpm --filter @xhs/database prisma:migrate && pnpm --filter @xhs/database test:integration`

Expected: PASS，重复同步后只有一条评论。

- [ ] **Step 5: 提交**

```bash
git add packages/database docker-compose.yml
git commit -m "feat: add persistent dashboard data model"
```

---

### Task 4: 官方连接器契约与模拟分页连接器

**Files:**
- Create: `packages/connector/package.json`
- Create: `packages/connector/src/index.ts`
- Create: `packages/connector/src/connector.ts`
- Create: `packages/connector/src/types.ts`
- Create: `packages/connector/src/mock/mock.connector.ts`
- Create: `packages/connector/src/mock/fixtures.ts`
- Create: `packages/connector/src/mock/mock.connector.spec.ts`

**Interfaces:**
- Produces: `XhsConnector` with `getCapabilities`, `beginAuthorization`, `completeAuthorization`, `listNotes`, `getNoteMetrics`, `listComments`, `listReplies`, `refreshCredential`
- Produces: `Page<T> = { items: T[]; nextCursor: string | null; hasMore: boolean }`

- [ ] **Step 1: 写连接器契约测试**

```ts
it('returns every mock comment across cursors without duplicate ids', async () => {
  const ids: string[] = [];
  let cursor: string | null = null;
  do {
    const page = await connector.listComments({ noteId: 'note-1', cursor });
    ids.push(...page.items.map((item) => item.platformId));
    cursor = page.nextCursor;
  } while (cursor);
  expect(new Set(ids).size).toBe(ids.length);
  expect(ids).toHaveLength(12);
});
```

- [ ] **Step 2: 运行并确认失败**

Run: `pnpm --filter @xhs/connector test`

Expected: FAIL，连接器尚未实现。

- [ ] **Step 3: 实现确定性模拟数据和游标**

模拟数据包含 3 个账号、每账号 4 条笔记、每笔记 12 条主评论、部分二级回复、30 天指标快照。所有对象必须包含 `source: 'mock'`，游标格式为 Base64 编码的数组偏移量。

- [ ] **Step 4: 验证连接器契约**

Run: `pnpm --filter @xhs/connector test && pnpm --filter @xhs/connector typecheck`

Expected: PASS，所有分页最终 `hasMore=false` 且 `nextCursor=null`。

- [ ] **Step 5: 提交**

```bash
git add packages/connector
git commit -m "feat: add official connector contract and mock adapter"
```

---

### Task 5: 同步编排器、断点与限流重试

**Files:**
- Create: `apps/worker/src/sync/sync.processor.ts`
- Create: `apps/worker/src/sync/sync.service.ts`
- Create: `apps/worker/src/sync/sync.service.spec.ts`
- Create: `apps/worker/src/queues.ts`
- Create: `apps/worker/src/worker.module.ts`
- Modify: `apps/worker/src/main.ts`

**Interfaces:**
- Consumes: `XhsConnector`, database repositories
- Produces: `runAccountSync(jobId: string, accountId: string): Promise<SyncResult>`
- Produces: queue `sync-account` with stable job id `sync:{accountId}:{businessDate}`

- [ ] **Step 1: 写中断后继续分页测试**

```ts
it('resumes comments from the persisted cursor after a retry', async () => {
  connector.failAfterPage(2);
  await expect(service.runAccountSync('job-1', 'account-1')).rejects.toThrow();
  connector.stopFailing();
  await service.runAccountSync('job-1', 'account-1');
  expect(await repository.countComments('note-1')).toBe(12);
  expect(await repository.getCommentCursor('job-1', 'note-1')).toBeNull();
});
```

- [ ] **Step 2: 运行并确认失败**

Run: `pnpm --filter worker test -- sync.service.spec.ts`

Expected: FAIL，缺少同步服务。

- [ ] **Step 3: 实现阶段状态机**

阶段固定为 `authorize -> notes -> metrics -> comments -> replies -> complete`。每页成功写库后同一事务更新游标；检测到重复游标时停止并标记 `unverifiable`。429 使用 BullMQ 指数退避与抖动，401/403 使用不可重试错误。

- [ ] **Step 4: 验证断点、幂等和部分失败**

Run: `pnpm --filter worker test && pnpm --filter worker typecheck`

Expected: PASS；重复执行不增加评论数，单账号失败不影响其他账号任务。

- [ ] **Step 5: 提交**

```bash
git add apps/worker
git commit -m "feat: orchestrate resumable account synchronization"
```

---

### Task 6: T+1 日报、周报、月报与补数重算

**Files:**
- Create: `packages/domain/src/metric-aggregation.ts`
- Create: `packages/domain/src/metric-aggregation.spec.ts`
- Create: `apps/worker/src/report/report.service.ts`
- Create: `apps/worker/src/report/report.service.spec.ts`
- Create: `apps/worker/src/report/report.processor.ts`
- Create: `apps/worker/src/report/report.scheduler.ts`
- Modify: `apps/worker/src/worker.module.ts`

**Interfaces:**
- Produces: `generateReport(type: ReportType, now: Date): Promise<ReportResult>`
- Produces: queues `generate-daily-report`, `generate-weekly-report`, `generate-monthly-report`, `rebuild-report`

- [ ] **Step 1: 写累计指标增量和周期测试**

```ts
it('uses snapshot deltas instead of summing cumulative totals', () => {
  expect(aggregateCumulative([100, 130, 151])).toBe(51);
});

it('marks a report incomplete when a required snapshot is missing', async () => {
  const report = await service.generateReport('daily', new Date('2026-08-02T08:00:00+08:00'));
  expect(report.status).toBe('awaiting_data');
  expect(report.missingDates).toEqual(['2026-08-01']);
});
```

- [ ] **Step 2: 运行并确认失败**

Run: `pnpm --filter @xhs/domain test && pnpm --filter worker test -- report.service.spec.ts`

Expected: FAIL，缺少聚合及报告服务。

- [ ] **Step 3: 实现报告版本与重算**

同一 `type + start + end + accountScope` 保留版本号。缺失数据生成 `awaiting_data` 版本；新快照写入后创建 `rebuild-report` 任务，成功后生成递增版本并保留旧版本审计记录。

- [ ] **Step 4: 验证所有时间边界**

Run: `pnpm --filter @xhs/domain test && pnpm --filter worker test`

Expected: PASS，覆盖日报、周一周报、每月 1 日月报、闰年和跨年。

- [ ] **Step 5: 提交**

```bash
git add packages/domain apps/worker/src/report apps/worker/src/worker.module.ts
git commit -m "feat: generate traceable periodic reports"
```

---

### Task 7: 通知事件与 Web Push

**Files:**
- Create: `apps/worker/src/notification/notification.service.ts`
- Create: `apps/worker/src/notification/notification.service.spec.ts`
- Create: `apps/worker/src/notification/notification.processor.ts`
- Create: `apps/api/src/notifications/notifications.controller.ts`
- Create: `apps/api/src/notifications/notifications.service.ts`
- Create: `apps/api/src/notifications/notifications.module.ts`
- Create: `apps/api/src/notifications/dto.ts`
- Modify: `apps/api/src/app.module.ts`

**Interfaces:**
- Produces: `publishNotification(event: DomainEvent): Promise<Notification>`
- Produces: `GET /notifications`, `PATCH /notifications/:id/read`, `POST /notifications/push-subscriptions`

- [ ] **Step 1: 写事件去重测试**

```ts
it('creates one notification for repeated delivery of the same event', async () => {
  await service.publishNotification(event);
  await service.publishNotification(event);
  expect(await repository.countByEventId(event.id)).toBe(1);
});
```

- [ ] **Step 2: 运行并确认失败**

Run: `pnpm --filter worker test -- notification.service.spec.ts`

Expected: FAIL，通知服务不存在。

- [ ] **Step 3: 实现站内通知和 Web Push 适配器**

事件类型固定为 `sync_completed`、`sync_failed`、`authorization_expired`、`new_comment`、`comment_sync_incomplete`、`report_generated`、`report_rebuilt`。浏览器拒绝权限时只保留站内通知，不将任务标记失败。

- [ ] **Step 4: 验证通知与 API**

Run: `pnpm --filter worker test && pnpm --filter api test`

Expected: PASS，重复事件只有一条通知，已读状态可持久化。

- [ ] **Step 5: 提交**

```bash
git add apps/worker/src/notification apps/api/src/notifications apps/api/src/app.module.ts
git commit -m "feat: deliver in-app and browser notifications"
```

---

### Task 8: 查询与任务控制 API

**Files:**
- Create: `apps/api/src/auth/auth.controller.ts`
- Create: `apps/api/src/auth/auth.service.ts`
- Create: `apps/api/src/auth/auth.guard.ts`
- Create: `apps/api/src/auth/auth.module.ts`
- Create: `apps/api/src/security/credential-cipher.ts`
- Create: `apps/api/src/security/credential-cipher.spec.ts`
- Create: `apps/api/src/accounts/accounts.controller.ts`
- Create: `apps/api/src/accounts/accounts.service.ts`
- Create: `apps/api/src/accounts/accounts.module.ts`
- Create: `apps/api/src/jobs/jobs.controller.ts`
- Create: `apps/api/src/jobs/jobs.service.ts`
- Create: `apps/api/src/jobs/jobs.module.ts`
- Create: `apps/api/src/notes/notes.controller.ts`
- Create: `apps/api/src/notes/notes.service.ts`
- Create: `apps/api/src/notes/notes.module.ts`
- Create: `apps/api/src/comments/comments.controller.ts`
- Create: `apps/api/src/comments/comments.service.ts`
- Create: `apps/api/src/comments/comments.module.ts`
- Create: `apps/api/src/dashboard/dashboard.controller.ts`
- Create: `apps/api/src/dashboard/dashboard.service.ts`
- Create: `apps/api/src/dashboard/dashboard.module.ts`
- Create: `apps/api/src/reports/reports.controller.ts`
- Create: `apps/api/src/reports/reports.service.ts`
- Create: `apps/api/src/reports/reports.module.ts`
- Create: `apps/api/src/common/pagination.dto.ts`
- Create: `apps/api/src/common/error.filter.ts`
- Create: `apps/api/src/common/audit.service.ts`
- Create: `apps/api/test/dashboard.e2e-spec.ts`
- Create: `apps/api/test/auth.e2e-spec.ts`
- Modify: `apps/api/src/app.module.ts`

**Interfaces:**
- Produces: REST resources `/accounts`, `/jobs`, `/notes`, `/comments`, `/dashboard`, `/reports`
- Produces: `POST /auth/login`, `POST /auth/logout`, signed `httpOnly` admin session cookie
- Produces: `GET /comments/export.csv` for the current authorized filter scope
- Produces: OpenAPI document at `/docs`

- [ ] **Step 1: 写 API 全流程失败测试**

```ts
it('returns dashboard data with explicit availability', async () => {
  const response = await request(app.getHttpServer()).get('/dashboard?period=daily').expect(200);
  expect(response.body.cards[0]).toMatchObject({
    key: 'likes',
    availability: expect.stringMatching(/available|zero|not_synced|awaiting_authorization|not_provided/),
  });
});

it('rejects protected endpoints without an admin session', async () => {
  await request(app.getHttpServer()).get('/accounts').expect(401);
});
```

- [ ] **Step 2: 运行并确认 404**

Run: `pnpm --filter api test:e2e -- dashboard.e2e-spec.ts`

Expected: FAIL，`/dashboard` 返回 404，`/accounts` 尚未受登录保护。

- [ ] **Step 3: 实现分页查询、任务控制和错误映射**

所有列表响应使用 `{ items, pageInfo: { nextCursor, hasMore } }`。创建同步任务返回 202 和任务标识。缺失能力返回正常资源并附带 availability，不使用 500。

单管理员密码只以 Argon2id 哈希形式通过 `ADMIN_PASSWORD_HASH` 配置；登录成功后签发带 `httpOnly`、`sameSite=strict`、生产环境 `secure` 的短期会话 Cookie。正式连接器凭证使用 `CREDENTIAL_ENCRYPTION_KEY` 和 Node.js `AES-256-GCM` 加密，密文保存随机 IV 与认证标签。授权新增、重新授权、停用、删除、任务配置和通知配置都写入 `AuditLog`。删除账号时先调用连接器撤销能力（若官方支持），再删除本地凭证；是否保留业务数据由显式请求参数决定且默认保留。

评论 CSV 导出复用页面筛选条件，只导出当前账号授权范围；单次导出超过 100,000 行时创建后台任务，不在 HTTP 请求中一次性加载全部数据。

- [ ] **Step 4: 验证 API 与 OpenAPI**

Run: `pnpm --filter api test && pnpm --filter api test:e2e && pnpm --filter api typecheck`

Expected: PASS，未登录请求返回 401；加密往返可恢复原文且两次密文不同；OpenAPI JSON 可生成且无重复 operation id。

- [ ] **Step 5: 提交**

```bash
git add apps/api
git commit -m "feat: expose dashboard and synchronization API"
```

---

### Task 9: 管理后台外壳与数据看板

**Files:**
- Create: `apps/web/app/(dashboard)/layout.tsx`
- Create: `apps/web/app/(dashboard)/dashboard/page.tsx`
- Create: `apps/web/components/app-shell.tsx`
- Create: `apps/web/components/metric-card.tsx`
- Create: `apps/web/components/metric-trend-chart.tsx`
- Create: `apps/web/components/data-availability.tsx`
- Create: `apps/web/lib/api.ts`
- Create: `apps/web/lib/format.ts`
- Create: `apps/web/components/metric-card.spec.tsx`
- Modify: `apps/web/app/page.tsx`

**Interfaces:**
- Consumes: `/dashboard`, `/notifications`
- Produces: responsive shell and `/dashboard`

- [ ] **Step 1: 写可用性展示失败测试**

```tsx
it('does not render unavailable metrics as zero', () => {
  render(<MetricCard label="访客" value={null} availability="awaiting_authorization" />);
  expect(screen.getByText('等待官方授权')).toBeInTheDocument();
  expect(screen.queryByText('0')).not.toBeInTheDocument();
});
```

- [ ] **Step 2: 运行并确认失败**

Run: `pnpm --filter web test -- metric-card.spec.tsx`

Expected: FAIL，组件不存在。

- [ ] **Step 3: 实现响应式后台和图表**

桌面侧栏包含总览、账号、任务、笔记、评论、报告和通知；手机使用底部主要导航和抽屉。首页首屏显示“昨日数据”，支持日报/周报/月报切换，并始终显示统计日期和最后同步时间。

- [ ] **Step 4: 验证页面**

Run: `pnpm --filter web test && pnpm --filter web typecheck && pnpm --filter web build`

Expected: PASS，无 hydration 错误。

- [ ] **Step 5: 提交**

```bash
git add apps/web
git commit -m "feat: build responsive analytics dashboard"
```

---

### Task 10: 账号、任务、笔记与评论页面

**Files:**
- Create: `apps/web/app/(dashboard)/accounts/page.tsx`
- Create: `apps/web/app/(dashboard)/jobs/page.tsx`
- Create: `apps/web/app/(dashboard)/notes/page.tsx`
- Create: `apps/web/app/(dashboard)/notes/[id]/page.tsx`
- Create: `apps/web/app/(dashboard)/comments/page.tsx`
- Create: `apps/web/app/login/page.tsx`
- Create: `apps/web/components/mock-qr-dialog.tsx`
- Create: `apps/web/components/job-progress.tsx`
- Create: `apps/web/components/comment-tree.tsx`
- Create: `apps/web/components/comment-completeness.tsx`
- Create: `apps/web/components/comment-tree.spec.tsx`

**Interfaces:**
- Consumes: account, job, note and comment APIs
- Produces: demo authorization, job controls, note details and paginated comment tree

- [ ] **Step 1: 写评论树和完整度失败测试**

```tsx
it('renders replies under their parent and labels page completion precisely', () => {
  render(<CommentTree comments={comments} completeness="page_complete" />);
  expect(screen.getByText('本轮官方分页已完成')).toBeInTheDocument();
  expect(screen.getByText('回复内容')).toHaveAttribute('data-parent-id', 'comment-1');
});
```

- [ ] **Step 2: 运行并确认失败**

Run: `pnpm --filter web test -- comment-tree.spec.tsx`

Expected: FAIL，组件不存在。

- [ ] **Step 3: 实现业务页面**

登录页只提交管理员密码，不保存到 localStorage。模拟扫码弹窗必须显示“演示授权，不会连接小红书”。任务页支持立即同步、暂停和重试。评论页支持账号、笔记、日期、关键词和新增状态筛选，使用游标加载更多，不一次性把全部评论放进浏览器内存，并提供“导出当前筛选”操作。

- [ ] **Step 4: 验证交互与构建**

Run: `pnpm --filter web test && pnpm --filter web build`

Expected: PASS，所有空状态和错误状态都有可操作提示。

- [ ] **Step 5: 提交**

```bash
git add apps/web
git commit -m "feat: add account job note and comment workflows"
```

---

### Task 11: 报告、通知和设置页面

**Files:**
- Create: `apps/web/app/(dashboard)/reports/page.tsx`
- Create: `apps/web/app/(dashboard)/reports/[id]/page.tsx`
- Create: `apps/web/app/(dashboard)/notifications/page.tsx`
- Create: `apps/web/app/(dashboard)/settings/page.tsx`
- Create: `apps/web/components/report-status.tsx`
- Create: `apps/web/components/notification-center.tsx`
- Create: `apps/web/components/push-permission.tsx`
- Create: `apps/web/public/sw.js`
- Create: `apps/web/components/report-status.spec.tsx`

**Interfaces:**
- Consumes: report and notification APIs
- Produces: report list/detail, notification inbox, Web Push enrollment

- [ ] **Step 1: 写待补全报告失败测试**

```tsx
it('shows missing dates and never labels an incomplete report complete', () => {
  render(<ReportStatus status="awaiting_data" missingDates={['2026-08-01']} />);
  expect(screen.getByText('等待数据补全')).toBeInTheDocument();
  expect(screen.getByText('缺少：2026-08-01')).toBeInTheDocument();
});
```

- [ ] **Step 2: 运行并确认失败**

Run: `pnpm --filter web test -- report-status.spec.tsx`

Expected: FAIL，组件不存在。

- [ ] **Step 3: 实现报告与通知体验**

报告详情展示统计区间、版本、覆盖账号、缺失数据和重算历史。设置页只读展示第一版周期规则。Web Push 仅在用户点击后请求权限，拒绝后不重复弹窗。

- [ ] **Step 4: 验证页面和 Service Worker**

Run: `pnpm --filter web test && pnpm --filter web build`

Expected: PASS，Service Worker 可注册，权限拒绝不抛异常。

- [ ] **Step 5: 提交**

```bash
git add apps/web
git commit -m "feat: add reports notifications and settings"
```

---

### Task 12: Docker、端到端验收与安全检查

**Files:**
- Create: `apps/web/Dockerfile`
- Create: `apps/api/Dockerfile`
- Create: `apps/worker/Dockerfile`
- Create: `tests/e2e/package.json`
- Create: `tests/e2e/playwright.config.ts`
- Create: `tests/e2e/dashboard-flow.spec.ts`
- Create: `scripts/seed-demo.ts`
- Create: `scripts/wait-for-health.ts`
- Create: `README.md`
- Modify: `docker-compose.yml`
- Modify: `.env.example`

**Interfaces:**
- Produces: `docker compose up --build` complete environment
- Produces: full demo journey from authorization through report and notification

- [ ] **Step 1: 写端到端失败测试**

```ts
test('demo account syncs comments and creates yesterday report', async ({ page }) => {
  await page.goto('/accounts');
  await page.getByRole('button', { name: '新增演示账号' }).click();
  await page.getByRole('button', { name: '完成演示授权' }).click();
  await page.getByRole('link', { name: '任务' }).click();
  await page.getByRole('button', { name: '立即同步' }).click();
  await expect(page.getByText('同步完成')).toBeVisible();
  await page.getByRole('link', { name: '评论' }).click();
  await expect(page.getByText('本轮官方分页已完成')).toBeVisible();
  await page.getByRole('link', { name: '报告' }).click();
  await expect(page.getByText('昨日日报')).toBeVisible();
});
```

- [ ] **Step 2: 启动全栈并确认测试在缺少完整流程时失败**

Run: `docker compose up -d --build && pnpm --filter e2e test`

Expected: FAIL，指出第一个未连接的用户流程。

- [ ] **Step 3: 补齐容器健康检查、演示种子和运行说明**

所有容器使用非 root 用户。Compose 不包含真实密钥。README 给出启动、停止、重置演示数据、运行测试和未来配置官方连接器的准确命令。

- [ ] **Step 4: 执行最终验证**

Run: `pnpm lint && pnpm typecheck && pnpm test && pnpm build && pnpm --filter e2e test`

Expected: 全部退出码为 0。

Run: `git grep -nEi '(app[_-]?secret|access[_-]?token|private[_-]?key)\s*[:=]\s*[^$<{]' -- ':!docs/**' ':!.env.example'`

Expected: 无真实凭证匹配。

- [ ] **Step 5: 完成规格逐项审计并提交**

逐条核对设计规格第 11.2 节的九项验收标准，记录对应自动化测试或运行证据到 `README.md` 的“验收状态”表。

```bash
git add .
git commit -m "feat: complete runnable dashboard demo"
```
