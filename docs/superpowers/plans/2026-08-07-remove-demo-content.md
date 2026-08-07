# 删除演示内容实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 删除所有演示界面、演示账号创建能力和生产数据库中的非真实账号数据，同时完整保留真实 `self-scrape` 账号及其数据。

**Architecture:** Web 端只渲染真实账号和官方 API 预留说明；API 授权入口默认拒绝所有未启用连接器；数据库包提供带 dry-run、真实账号保护和清理后断言的维护脚本。生产清理必须在完整备份之后执行，并用清理前后统计证明真实数据未变化。

**Tech Stack:** Next.js 15、React 19、NestJS 11、Prisma 7、PostgreSQL、Vitest、pnpm、macOS launchd 服务脚本。

## Global Constraints

- 真实账号固定保护条件：`connectorType = 'self-scrape'` 且 `xhsAccountId = '95874286519'`。
- 真实账号“南瓜汤与瓜子仁”的账号 ID、笔记、指标快照、评论、任务和报告数据在清理前后必须保持不变。
- 官方 API 的静态预留入口和 connector 扩展边界必须保留，但不保留测试账号。
- 现有 mock connector 接口不重构；只移除生产创建能力和用户可见演示内容。
- 所有数据库测试必须使用独立测试数据库，禁止连接运行中的 `xhs_dashboard`。
- 每个完整代码步骤都必须提交并推送 `origin/main`。

---

### Task 1: 移除 Web 演示入口和演示文案

**Files:**
- Create: `apps/web/app/(dashboard)/accounts/page.spec.tsx`
- Modify: `apps/web/app/(dashboard)/accounts/page.tsx`
- Modify: `apps/web/components/settings-overview.spec.tsx`
- Modify: `apps/web/components/settings-overview.tsx`
- Modify: `apps/web/components/note-explorer.spec.tsx`
- Modify: `apps/web/components/note-explorer.tsx`
- Modify: `apps/web/app/(dashboard)/notes/[id]/page.tsx`
- Delete: `apps/web/components/mock-qr-dialog.tsx`
- Delete: `apps/web/components/mock-qr-dialog.spec.tsx`
- Delete: `apps/web/components/account-lifecycle.tsx`
- Delete: `apps/web/components/account-lifecycle.spec.tsx`
- Modify: `apps/web/components/account-actions.tsx`
- Modify: `apps/web/app/globals.css`

**Interfaces:**
- Consumes: `getAccounts(cursor)` and `SelfImportLogin({ accounts })` already used by the account page.
- Produces: an accounts page that filters management rows to `connectorType === 'self-scrape'`, plus source-label helpers that only expose “账号自抓数据” and “官方 API”.

- [ ] **Step 1: Write failing account-page and source-copy tests**

Add a page test with mocked `getAccounts` returning one `self-scrape` item and one `mock` item. Render the async page and assert:

```tsx
expect(screen.getByText('南瓜汤与瓜子仁')).toBeInTheDocument();
expect(screen.queryByText('演示授权')).not.toBeInTheDocument();
expect(screen.queryByText('演示连接器')).not.toBeInTheDocument();
expect(screen.queryByText('创建演示账号')).not.toBeInTheDocument();
expect(screen.queryByText('测试账号')).not.toBeInTheDocument();
expect(screen.getByText('官方 API 尚未配置')).toBeInTheDocument();
```

Extend settings and note-explorer tests with:

```tsx
expect(document.body.textContent).not.toContain('演示数据');
expect(document.body.textContent).not.toContain('演示连接器');
```

- [ ] **Step 2: Run the focused tests and verify RED**

Run:

```bash
pnpm --filter web test -- 'app/(dashboard)/accounts/page.spec.tsx' components/settings-overview.spec.tsx components/note-explorer.spec.tsx
```

Expected: FAIL because the existing page still renders the mock dialog/form/item and settings still contains the演示数据 card.

- [ ] **Step 3: Implement the minimal Web removal**

Remove `MockQrDialog`, `AccountConnect`, mock reauthorization, demo account actions, and their imports. Compute both account-card and management-list inputs from:

```ts
const realAccounts = items.filter((account) => account.connectorType === 'self-scrape');
```

Keep `SelfImportLogin` and the official API notice. Remove unused `.mock-dialog` and `.mock-qr` CSS. Change fallback source copy so unknown connector types are not labeled or rendered as official data.

- [ ] **Step 4: Run focused Web tests and typecheck**

Run:

```bash
pnpm --filter web test -- 'app/(dashboard)/accounts/page.spec.tsx' components/settings-overview.spec.tsx components/note-explorer.spec.tsx
pnpm --filter web typecheck
```

Expected: all selected tests PASS and TypeScript exits 0.

- [ ] **Step 5: Commit and push**

```bash
git add apps/web
git commit -m "feat: remove demo content from dashboard"
git push origin HEAD:main
```

### Task 2: 禁止生产 API 再创建演示账号

**Files:**
- Create: `apps/api/src/accounts/accounts.service.spec.ts`
- Modify: `apps/api/src/accounts/accounts.service.ts`
- Modify: `apps/web/lib/bff.ts`

**Interfaces:**
- Consumes: `AccountsService.authorize(input)` and BFF `validateDto('/accounts/authorize', value)`.
- Produces: `authorize()` always throws `ForbiddenException('connector authorization is not available')` until an official connector is explicitly enabled in a future change; BFF no longer advertises `mock` as an accepted production connector.

- [ ] **Step 1: Write failing API unit tests without a database**

Instantiate `AccountsService` with an audit stub and test that the method rejects before any Prisma call:

```ts
it.each(['mock', 'official', 'schema-test'])('rejects unavailable connector %s', async (connectorType) => {
  await expect(service.authorize({ connectorType, platformId: 'p1', secret: 'secret', kind: 'token' }))
    .rejects.toThrow('connector authorization is not available');
});
```

The production change that makes this pass is an unconditional fail-closed guard at the beginning of `authorize`.

- [ ] **Step 2: Run the unit test and verify RED**

Run:

```bash
pnpm --filter api test -- src/accounts/accounts.service.spec.ts
```

Expected: FAIL for `mock` and `schema-test`, proving those inputs currently reach database code.

- [ ] **Step 3: Add the fail-closed production guard**

At the beginning of `authorize`, throw the existing NestJS forbidden error for every connector while official authorization is unavailable:

```ts
throw new ForbiddenException('connector authorization is not available');
```

Remove the unreachable authorization transaction body only if TypeScript marks it unreachable; do not change list, deactivate, revoke, registry, or local self-scrape synchronization behavior. Update BFF validation to reject `/accounts/authorize` with `connector not available` rather than accepting `mock`.

- [ ] **Step 4: Run unit tests and typechecks**

Run:

```bash
pnpm --filter api test -- src/accounts/accounts.service.spec.ts
pnpm --filter api typecheck
pnpm --filter web typecheck
```

Expected: PASS with no database access and both typechecks exit 0.

- [ ] **Step 5: Commit and push**

```bash
git add apps/api/src/accounts/accounts.service.ts apps/api/src/accounts/accounts.service.spec.ts apps/web/lib/bff.ts
git commit -m "fix: reject unavailable account connectors"
git push origin HEAD:main
```

### Task 3: 增加受保护的演示数据清理工具

**Files:**
- Create: `packages/database/src/demo-content-cleanup.ts`
- Create: `packages/database/src/demo-content-cleanup.spec.ts`
- Create: `packages/database/src/remove-demo-content.ts`
- Modify: `packages/database/package.json`

**Interfaces:**
- Consumes: a Prisma transaction client and `{ protectedXhsAccountId: string; execute: boolean }`.
- Produces: `planDemoCleanup(tx, protectedXhsAccountId): Promise<CleanupPlan>`, `removeDemoContent(prisma, options): Promise<CleanupResult>`, and CLI command `pnpm --filter @xhs/database cleanup:demo -- [--execute]`.

Define the stable result shape:

```ts
type ProtectedCounts = {
  accountId: string; notes: number; snapshots: number; comments: number;
  syncJobs: number; reports: number;
};
type CleanupPlan = { protected: ProtectedCounts; deleteAccountIds: string[] };
type CleanupResult = CleanupPlan & { executed: boolean; deletedAccounts: number };
```

- [ ] **Step 1: Write failing pure unit tests for protection and dry-run**

Use a small fake transaction adapter to assert:

```ts
await expect(planDemoCleanup(txWithoutProtectedAccount, '95874286519'))
  .rejects.toThrow('protected self-scrape account not found');
expect((await planDemoCleanup(tx, '95874286519')).deleteAccountIds)
  .toEqual(['mock-id', 'official-test-id']);
expect(await removeDemoContent(prisma, { protectedXhsAccountId: '95874286519', execute: false }))
  .toMatchObject({ executed: false, deletedAccounts: 0 });
```

Also assert that dry-run never invokes delete operations.

- [ ] **Step 2: Run cleanup tests and verify RED**

Run:

```bash
pnpm --filter @xhs/database exec vitest run src/demo-content-cleanup.spec.ts
```

Expected: FAIL because the cleanup module does not exist.

- [ ] **Step 3: Implement guarded planning and transaction cleanup**

Implement an adapter narrow enough for unit testing. Inside the execute transaction:

1. Lock the protected account row and assert exactly one `self-scrape` account has `xhsAccountId = '95874286519'`.
2. Capture protected counts.
3. Resolve all `Account.id` values where `connectorType <> 'self-scrape'`.
4. Delete dependent `MetricSnapshot`, `Comment`, `ReportMetric`, `Report`, `Note`, and account-cascade rows for only those IDs.
5. Delete the candidate accounts.
6. Delete only orphan `MetricDefinition` records whose key is not `views`, `likes`, or `comments` and which have no snapshots or report metrics.
7. Recompute protected counts and throw if any count or account ID changed.

The CLI defaults to dry-run, prints JSON only, and requires the exact `--execute` flag for mutation. It must refuse execution if `DATABASE_URL` is missing or if the protected account assertion fails.

- [ ] **Step 4: Run cleanup unit tests and database typecheck**

Run:

```bash
pnpm --filter @xhs/database exec vitest run src/demo-content-cleanup.spec.ts
pnpm --filter @xhs/database typecheck
```

Expected: PASS and TypeScript exits 0.

- [ ] **Step 5: Commit and push**

```bash
git add packages/database/src/demo-content-cleanup.ts packages/database/src/demo-content-cleanup.spec.ts packages/database/src/remove-demo-content.ts packages/database/package.json
git commit -m "feat: add guarded demo data cleanup"
git push origin HEAD:main
```

### Task 4: 备份并清理生产数据库

**Files:**
- Runtime artifact: `/Users/jixiang/Library/Application Support/xiaohongshu-dashboard/backups/xhs-dashboard-before-demo-cleanup-<timestamp>.dump`
- Runtime record: `/Users/jixiang/Library/Application Support/xiaohongshu-dashboard/backups/xhs-dashboard-before-demo-cleanup-<timestamp>.json`

**Interfaces:**
- Consumes: the deployed cleanup CLI and current local PostgreSQL container/service configuration.
- Produces: a non-empty PostgreSQL custom-format backup, before/after JSON counts, and a database containing only `self-scrape` accounts.

- [ ] **Step 1: Run read-only inventory and dry-run**

Run the cleanup CLI without `--execute`, save its JSON output, and separately query account counts grouped by connector type. Verify the protected account ID and all protected counts are present.

- [ ] **Step 2: Create and verify the database backup**

Create the explicit backup directory, run `pg_dump --format=custom` against the actual dashboard database using the service's configured credentials, then verify:

```bash
test -s "/Users/jixiang/Library/Application Support/xiaohongshu-dashboard/backups/xhs-dashboard-before-demo-cleanup-<timestamp>.dump"
pg_restore --list "/Users/jixiang/Library/Application Support/xiaohongshu-dashboard/backups/xhs-dashboard-before-demo-cleanup-<timestamp>.dump" >/dev/null
```

Expected: both commands exit 0 before any delete is attempted.

- [ ] **Step 3: Execute the guarded transaction**

Run:

```bash
pnpm --filter @xhs/database cleanup:demo -- --execute
```

Expected: JSON reports `executed: true`, a positive or zero `deletedAccounts`, and unchanged protected counts.

- [ ] **Step 4: Verify the production result read-only**

Confirm only `self-scrape` remains in `Account`, then compare the real account ID and every protected count with the pre-cleanup JSON. Verify `views`, `likes`, and `comments` metric definitions still exist.

- [ ] **Step 5: Record the operational result without committing secrets or dumps**

Write the backup path, timestamp, deleted account count, and before/after protected counts into the adjacent JSON runtime record. Do not add the backup or runtime record to Git.

### Task 5: 部署和浏览器验收

**Files:**
- No source changes expected.

**Interfaces:**
- Consumes: committed application code, cleaned database, and `ops/macos/xhs-services.sh`.
- Produces: healthy persistent services and visually verified pages with no demo content.

- [ ] **Step 1: Run safe regression suites**

Run Web tests and the focused API/database unit tests only:

```bash
pnpm --filter web test
pnpm --filter web typecheck
pnpm --filter api test -- src/accounts/accounts.service.spec.ts
pnpm --filter api typecheck
pnpm --filter @xhs/database exec vitest run src/demo-content-cleanup.spec.ts
pnpm --filter @xhs/database typecheck
```

Do not run existing database integration suites unless `DATABASE_URL` has been changed to a freshly created isolated test database.

- [ ] **Step 2: Install and restart persistent services**

Run:

```bash
zsh ops/macos/xhs-services.sh install '11111'
zsh ops/macos/xhs-services.sh status
```

Expected: PostgreSQL, Redis, API, collector and Web all report healthy/running.

- [ ] **Step 3: Perform browser QA**

Verify `/accounts`, `/settings`, `/notes`, one note detail page, and `/dashboard`. Assert no visible text matches `演示授权|演示连接器|创建演示账号|演示数据`; verify the real account, “立即同步”, “登录新账号”, official API notice, comments, and export controls still work. Check console errors and responsive layout.

- [ ] **Step 4: Verify Git and remote state**

Run:

```bash
git status --short
git log -5 --oneline
git fetch origin main
git rev-parse HEAD
git rev-parse origin/main
```

Expected: only the previously known unrelated dirty report and `.next.corrupt-20260805-qa/` remain; `HEAD` equals `origin/main`.

- [ ] **Step 5: Final handoff**

Report the deployed revision, passing test commands, protected real-data before/after counts, backup absolute path, browser QA result, and any known limitations. Never expose database credentials, cookies, tokens, or session files.
