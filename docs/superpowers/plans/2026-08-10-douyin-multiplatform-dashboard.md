# Douyin Multiplatform Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the existing Xiaohongshu dashboard into a Xiaohongshu-and-Douyin dashboard with Xiaohuohua collection first, JSON and official API seams retained, complete comment/reply evidence, mixed-platform reporting, filters, and exports.

**Architecture:** Add explicit platform and source dimensions to the shared model, then normalize every collector/import connector into one versioned event contract. Keep Xiaohongshu and Douyin page parsing isolated behind adapters; the API, reports, exports, and web UI consume only normalized database records.

**Tech Stack:** TypeScript 5.9, Node.js, NestJS, Next.js 15, React 19, Prisma/PostgreSQL, BullMQ/Redis, Playwright, Vitest, Docker Compose, launchd.

## Global Constraints

- Business timezone is exactly `Asia/Shanghai`.
- Platforms are exactly `xiaohongshu` and `douyin` in the first release.
- Sources are explicit and separate from platform; first-release source values are `xiaohuohua`, `self-import`, `official`, plus backward-compatible existing values.
- Normal daily collection reads only the current Shanghai calendar month through the business day.
- Only a run with mode `previous_month_final` on the first Shanghai calendar day may read the previous calendar month.
- Scheduled but unpublished content must not be imported as published content.
- Unknown metrics use an unavailable state and `null`; never convert an unknown value to zero.
- Comment completeness is `complete` only after every comment page and every reply expansion reaches a platform end marker.
- Existing Xiaohongshu data, mock behavior, self-scrape JSON import, official connector seam, UUIDs, and reports must remain usable.
- Do not read, export, log, or store Xiaohuohua/Douyin passwords, cookies, QR credentials, or tokens.
- Every implementation task uses TDD, ends with focused verification, and is committed and pushed before the next task.

---

## File Structure Map

- `packages/domain/src/platform.ts`: platform/source literals, validators, labels, and platform-aware identity keys.
- `packages/domain/src/platform-event.ts`: normalized account/content/metric/comment/completeness event interfaces.
- `packages/database/prisma/schema.prisma`: explicit platform/source fields and platform-scoped uniqueness.
- `packages/database/prisma/migrations/0022_multiplatform_dimensions/migration.sql`: additive backfill migration preserving IDs.
- `packages/database/src/platform-collection.ts`: transactional, idempotent normalized event importer.
- `packages/self-scrape-import/src/collection-schema.ts`: version-1 compatibility parser delegating to the normalized contract.
- `apps/collector/src/xiaohuohua/client.ts`: loopback-only connection to a user-launched Xiaohuohua debugging endpoint.
- `apps/collector/src/xiaohuohua/account-discovery.ts`: discovers logged-in Xiaohongshu and Douyin account surfaces without credentials.
- `apps/collector/src/douyin/page-adapter.ts`: Douyin account/content/metric/comment/reply DOM mapping.
- `apps/collector/src/platform-session-manager.ts`: platform/account-scoped collection orchestration.
- `apps/api/src/platforms/*`: platform listing, discovery, account sync, and official-connector status.
- `apps/api/src/dashboard/*`, `notes/*`, `comments/*`, `reports/*`: platform filters and normalized labels.
- `apps/worker/src/report/*`, `sync/*`: source policy, monthly windows, and platform-safe report aggregation.
- `apps/web/components/platform-filter.tsx`: all/Xiaohongshu/Douyin filter shared by pages.
- `apps/web/components/mixed-platform-overview.tsx`: side-by-side platform cards without invalid metric summation.
- `apps/web/app/(dashboard)/*`: mixed overview and platform-aware account/content/comment/report pages.

---

### Task 1: Platform and Source Domain Contracts

**Files:**
- Create: `packages/domain/src/platform.ts`
- Create: `packages/domain/src/platform.spec.ts`
- Create: `packages/domain/src/platform-event.ts`
- Modify: `packages/domain/src/index.ts`

**Interfaces:**
- Produces: `Platform`, `ObservationSource`, `ContentKind`, `CommentCompletenessState`, `PlatformCollectionEventV2`, `platformIdentityKey()`.
- Consumed by: database importer, collector adapters, worker source policy, API DTOs, and web response types.

- [ ] **Step 1: Write failing domain tests**

```ts
import { describe, expect, it } from 'vitest';
import { parsePlatform, parseObservationSource, platformIdentityKey } from './platform';

describe('platform contracts', () => {
  it('keeps identical remote ids isolated by platform', () => {
    expect(platformIdentityKey('xiaohongshu', '42')).toBe('xiaohongshu:42');
    expect(platformIdentityKey('douyin', '42')).toBe('douyin:42');
  });
  it('rejects unapproved values', () => {
    expect(() => parsePlatform('kuaishou')).toThrow('unsupported_platform');
    expect(() => parseObservationSource('cookie-dump')).toThrow('unsupported_source');
  });
});
```

- [ ] **Step 2: Run the domain test and verify failure**

Run: `pnpm --filter @xhs/domain test -- platform.spec.ts`

Expected: FAIL because `./platform` does not exist.

- [ ] **Step 3: Implement exact literals and normalized event interfaces**

```ts
export const PLATFORMS = ['xiaohongshu', 'douyin'] as const;
export type Platform = typeof PLATFORMS[number];
export const OBSERVATION_SOURCES = ['xiaohuohua', 'self-import', 'official', 'mock', 'self-scrape', 'legacy'] as const;
export type ObservationSource = typeof OBSERVATION_SOURCES[number];
export type ContentKind = 'note' | 'video' | 'image_text';
export type CommentCompletenessState = 'complete' | 'partial' | 'failed' | 'not_available';
export const platformIdentityKey = (platform: Platform, id: string) => `${platform}:${id}`;
export function parsePlatform(value: unknown): Platform {
  if (!PLATFORMS.includes(value as Platform)) throw new Error('unsupported_platform');
  return value as Platform;
}
export function parseObservationSource(value: unknown): ObservationSource {
  if (!OBSERVATION_SOURCES.includes(value as ObservationSource)) throw new Error('unsupported_source');
  return value as ObservationSource;
}
```

Define `PlatformCollectionEventV2` as a discriminated union with required base fields `{ version: 2; platform; source; runId }` and event types `account`, `content`, `metric`, `comment`, `completeness`, and `completed`. Metric keys must include `views`, `likes`, `comments`, `favorites`, `shares`, and `followers`.

- [ ] **Step 4: Export the contracts and run domain checks**

Run: `pnpm --filter @xhs/domain test && pnpm --filter @xhs/domain typecheck`

Expected: PASS.

- [ ] **Step 5: Commit and push**

```bash
git add packages/domain/src/platform.ts packages/domain/src/platform.spec.ts packages/domain/src/platform-event.ts packages/domain/src/index.ts
git commit -m "feat: add multiplatform domain contracts"
git push origin HEAD:main
```

---

### Task 2: Additive Multiplatform Database Migration

**Files:**
- Modify: `packages/database/prisma/schema.prisma`
- Create: `packages/database/prisma/migrations/0022_multiplatform_dimensions/migration.sql`
- Create: `packages/database/src/multiplatform-migration.integration.spec.ts`

**Interfaces:**
- Consumes: Task 1 platform/source literals conceptually; Prisma stores strings to allow additive evolution.
- Produces: platform-scoped unique records and source-preserving account/content/comment/metric queries.

- [ ] **Step 1: Write a failing migration integration test**

```ts
it('allows the same remote id on Xiaohongshu and Douyin', async () => {
  await prisma.account.create({ data: { platform: 'xiaohongshu', source: 'self-scrape', connectorType: 'self-scrape', platformId: 'same' } });
  await expect(prisma.account.create({ data: { platform: 'douyin', source: 'xiaohuohua', connectorType: 'xiaohuohua', platformId: 'same' } })).resolves.toMatchObject({ platform: 'douyin' });
});
```

Also assert every pre-migration account, note, comment, definition, snapshot, report, and job remains present after migration and existing account UUIDs are unchanged.

- [ ] **Step 2: Run database tests and verify failure**

Run: `pnpm --filter @xhs/database test -- multiplatform-migration.integration.spec.ts`

Expected: FAIL because `platform` and normalized `source` columns do not exist.

- [ ] **Step 3: Add schema columns and platform-scoped indexes**

Add `platform String @default("xiaohongshu")` and `source String` to `Account`; add `platform`, `source`, and `contentKind` to `Note`; add `platform` to `Comment` and `MetricDefinition`. Change MetricDefinition uniqueness to `@@unique([platform, key, source, version])`. Replace remote uniqueness with:

```prisma
@@unique([platform, platformId])
```

for Account and Note, and:

```prisma
@@unique([platform, platformId])
@@index([platform, noteId, publishedAt])
```

for Comment. Preserve `connectorType` during the compatibility period.

- [ ] **Step 4: Write the additive SQL migration**

The migration must:

```sql
ALTER TABLE "Account" ADD COLUMN "platform" TEXT NOT NULL DEFAULT 'xiaohongshu';
ALTER TABLE "Account" ADD COLUMN "source" TEXT;
UPDATE "Account" SET "source" = CASE WHEN "connectorType" = 'self-scrape' THEN 'self-scrape' ELSE "connectorType" END WHERE "source" IS NULL;
ALTER TABLE "Account" ALTER COLUMN "source" SET NOT NULL;
```

Repeat the additive/backfill pattern for Note, Comment, and MetricDefinition, then create replacement unique indexes before dropping old connector-scoped unique indexes. Do not update primary keys or delete rows.

- [ ] **Step 5: Generate Prisma client and run migration tests**

Run:

```bash
pnpm --filter @xhs/database prisma:generate
pnpm --filter @xhs/database test
```

Expected: PASS, with pre-existing UUID preservation asserted.

- [ ] **Step 6: Commit and push**

```bash
git add packages/database/prisma packages/database/src/multiplatform-migration.integration.spec.ts packages/database/generated
git commit -m "feat: add platform dimensions to data model"
git push origin HEAD:main
```

---

### Task 3: Versioned Normalized Collection Contract

**Files:**
- Modify: `packages/self-scrape-import/src/collection-schema.ts`
- Modify: `packages/self-scrape-import/src/collection-schema.spec.ts`
- Create: `packages/self-scrape-import/src/platform-schema.ts`
- Modify: `packages/self-scrape-import/src/index.ts`

**Interfaces:**
- Consumes: `PlatformCollectionEventV2` from Task 1.
- Produces: `normalizePlatformCollectionEvent(input): PlatformCollectionEventV2` and a backward-compatible `normalizeCollectionEvent()` for existing V1 Xiaohongshu JSONL.

- [ ] **Step 1: Add failing parser cases**

```ts
expect(normalizePlatformCollectionEvent({
  version: 2, platform: 'douyin', source: 'xiaohuohua', runId: 'run-1', type: 'metric',
  metric: { contentId: 'video-1', key: 'favorites', value: null, availability: 'not_provided', capturedAt: '2026-08-10T09:00:00+08:00' },
})).toMatchObject({ platform: 'douyin', metric: { value: null } });
```

Add cases rejecting unknown root fields, cross-platform IDs, negative counts, timestamps without offsets, `complete` without `platform_end`, and a metric with `not_provided` plus numeric value.

- [ ] **Step 2: Run parser tests and verify failure**

Run: `pnpm --filter @xhs/self-scrape-import test -- collection-schema.spec.ts`

Expected: FAIL because the V2 parser is missing.

- [ ] **Step 3: Implement strict V2 normalization and V1 conversion**

V1 events convert to V2 with `{ platform: 'xiaohongshu', source: 'self-scrape' }`; V1 note becomes V2 content with `contentKind: 'note'`. V2 rejects properties not listed for the event type and caps text and identifier lengths using the current parser limits.

- [ ] **Step 4: Run package tests and typecheck**

Run: `pnpm --filter @xhs/self-scrape-import test && pnpm --filter @xhs/self-scrape-import typecheck`

Expected: PASS for V1 fixtures and new Douyin V2 fixtures.

- [ ] **Step 5: Commit and push**

```bash
git add packages/self-scrape-import/src
git commit -m "feat: normalize multiplatform collection events"
git push origin HEAD:main
```

---

### Task 4: Transactional Platform Collection Importer

**Files:**
- Create: `packages/database/src/platform-collection.ts`
- Create: `packages/database/src/platform-collection.integration.spec.ts`
- Modify: `packages/database/src/self-scrape-collection.ts`
- Modify: `packages/database/src/index.ts`

**Interfaces:**
- Produces: `importPlatformCollection(events, { db, runId, platform, accountPlatformId, source }): Promise<PlatformImportSummary>`.
- `PlatformImportSummary` contains accountId, platform, source, contentsChanged, snapshotsChanged, commentsChanged, incompleteContents, and sha256.
- Existing `importSelfScrapeCollection()` becomes a compatibility wrapper.

- [ ] **Step 1: Write failing importer tests**

Test one Douyin account with one video, five metric events, one root comment, one reply, and `complete`. Replay the same events and expect zero changed rows. Import the same remote IDs under Xiaohongshu and expect separate rows.

```ts
expect(await prisma.metricDefinition.count({ where: { platform: 'douyin', source: 'xiaohuohua' } })).toBe(5);
expect(await prisma.comment.count({ where: { platform: 'douyin' } })).toBe(2);
```

- [ ] **Step 2: Run the focused test and verify failure**

Run: `pnpm --filter @xhs/database test -- platform-collection.integration.spec.ts`

Expected: FAIL because `importPlatformCollection` is missing.

- [ ] **Step 3: Implement idempotent transaction boundaries**

Upsert account/content/comment using `(platform, platformId)`. Create metric definitions using `(platform, key, source, version)` semantics. Append metric corrections using existing revision/supersession fields. Require each comment's content ID to belong to the same platform/account. Store incomplete status unless both comments and replies reach `platform_end`.

- [ ] **Step 4: Preserve V1 behavior through the wrapper**

```ts
export function importSelfScrapeCollection(events: Iterable<unknown>, options: SelfScrapeOptions) {
  return importPlatformCollection(events, { ...options, platform: 'xiaohongshu', source: 'self-scrape' });
}
```

- [ ] **Step 5: Run database and worker import tests**

Run:

```bash
pnpm --filter @xhs/database test
pnpm --filter worker test -- self-scrape-collection.service.spec.ts self-scrape-import.service.spec.ts
```

Expected: PASS with no V1 row-count changes.

- [ ] **Step 6: Commit and push**

```bash
git add packages/database/src
git commit -m "feat: import normalized platform collections"
git push origin HEAD:main
```

---

### Task 5: Loopback Xiaohuohua Account Discovery Bridge

**Files:**
- Create: `apps/collector/src/xiaohuohua/client.ts`
- Create: `apps/collector/src/xiaohuohua/client.spec.ts`
- Create: `apps/collector/src/xiaohuohua/account-discovery.ts`
- Create: `apps/collector/src/xiaohuohua/account-discovery.spec.ts`
- Modify: `ops/macos/xhs-services.sh`
- Modify: `ops/macos/xhs-services.test.sh`

**Interfaces:**
- Produces: `XiaohuohuaClient.connect({ endpoint }): Promise<XiaohuohuaSession>` and `discoverAccounts(session): Promise<DiscoveredPlatformAccount[]>`.
- `DiscoveredPlatformAccount` is `{ platform, platformId, displayName, avatarUrl, loginState, surfaceId }`.
- Consumed by Task 7 session orchestration.

- [ ] **Step 1: Write failing allowlist and discovery tests**

```ts
expect(() => validateEndpoint('http://192.168.0.8:43128')).toThrow('xiaohuohua_loopback_required');
expect(discoverAccounts(fixtureSession)).resolves.toEqual(expect.arrayContaining([
  expect.objectContaining({ platform: 'douyin', displayName: 'Tonic', loginState: 'authenticated' }),
]));
```

- [ ] **Step 2: Run collector tests and verify failure**

Run: `pnpm --filter collector test -- xiaohuohua`

Expected: FAIL because bridge files do not exist.

- [ ] **Step 3: Implement a loopback-only read interface**

The client may connect only to `http://127.0.0.1:<configured-port>`. It may inspect visible DOM/accessibility content for account identity and page data, but it must reject cookie, localStorage, password, token, QR payload, and request-header extraction APIs. Redact URL query strings before logging.

- [ ] **Step 4: Add opt-in launchd configuration**

Add `XIAOHUOHUA_BRIDGE_ENABLED=false` by default and `XIAOHUOHUA_BRIDGE_URL=http://127.0.0.1:43128`. When explicitly enabled, the launcher starts `/Applications/小火花.app/Contents/MacOS/小火花` with `--remote-debugging-address=127.0.0.1 --remote-debugging-port=43128`; validate the executable path before launch and never add a non-loopback address. The service must remain healthy when Xiaohuohua is closed; discovery returns `unavailable`, not a crash loop. Do not expose port 43128 on LAN interfaces.

- [ ] **Step 5: Run security-focused and service tests**

Run:

```bash
pnpm --filter collector test
zsh ops/macos/xhs-services.test.sh
zsh ops/macos/docker-network-boundary.test.sh
```

Expected: PASS and no non-loopback collector/bridge listeners.

- [ ] **Step 6: Commit and push**

```bash
git add apps/collector/src/xiaohuohua ops/macos
git commit -m "feat: discover accounts through local xiaohuohua bridge"
git push origin HEAD:main
```

---

### Task 6: Douyin Page Adapter and Complete Comment Traversal

**Files:**
- Create: `apps/collector/src/douyin/page-adapter.ts`
- Create: `apps/collector/src/douyin/page-adapter.spec.ts`
- Create: `apps/collector/src/douyin/fixtures/account.html`
- Create: `apps/collector/src/douyin/fixtures/content-list.html`
- Create: `apps/collector/src/douyin/fixtures/comments.html`
- Create: `apps/collector/src/douyin/collection.ts`
- Create: `apps/collector/src/douyin/collection.spec.ts`

**Interfaces:**
- Produces: `DouyinPageAdapter.readAccount()`, `listPublishedContent(window)`, `readMetrics(content)`, `readAllComments(content, progress)`.
- Produces only `PlatformCollectionEventV2` with `platform: 'douyin'` and `source: 'xiaohuohua'`.

- [ ] **Step 1: Write fixture-driven failing tests**

Test the exact mapping `{ views, comments, likes, favorites, shares }` instead of assuming icon order. Include a scheduled Aug 10 item and assert it is excluded, a published Aug 2 item and assert it is included, an expired login fixture, repeated cursor fixture, and nested replies fixture.

```ts
expect(result.metrics).toMatchObject({ views: 239, comments: 11, likes: 2, favorites: 0, shares: 0 });
expect(result.contents.some((item) => item.publishState === 'scheduled')).toBe(false);
```

- [ ] **Step 2: Run adapter tests and verify failure**

Run: `pnpm --filter collector test -- douyin/page-adapter.spec.ts douyin/collection.spec.ts`

Expected: FAIL because the adapter is missing.

- [ ] **Step 3: Implement stable page contracts**

Prefer accessible labels and stable platform attributes from fixtures. Put selectors in one `DOUYIN_SELECTORS` object. If required selectors disappear, emit `page_changed` and `partial`; do not guess from element position.

- [ ] **Step 4: Implement current-month and first-day windows**

Use `rollingSyncWindow(businessDate, mode, 'Asia/Shanghai')` from the domain package. Reject `previous_month_final` unless the business date day is `1`. Filter on published timestamp and publish state before emitting content.

- [ ] **Step 5: Traverse comments and replies to platform end**

Continue while `hasMore` is true and cursor changes. Expand every reply group, preserving `parentPlatformId`. Emit `complete` only when the final page declares no more comments and every reply group declares no more replies; emit `partial` for repeated cursors, page changes, authorization, or timeouts.

- [ ] **Step 6: Run collector tests and typecheck**

Run: `pnpm --filter collector test && pnpm --filter collector typecheck`

Expected: PASS.

- [ ] **Step 7: Commit and push**

```bash
git add apps/collector/src/douyin
git commit -m "feat: collect douyin content metrics and comments"
git push origin HEAD:main
```

---

### Task 7: Platform-Scoped Collector Sessions and Multi-Account Sync

**Files:**
- Create: `apps/collector/src/platform-session-manager.ts`
- Create: `apps/collector/src/platform-session-manager.spec.ts`
- Modify: `apps/collector/src/server.ts`
- Modify: `apps/collector/src/server.spec.ts`
- Modify: `apps/api/src/local-collector/local-collector.service.ts`
- Modify: `apps/api/src/local-collector/local-collector.service.spec.ts`

**Interfaces:**
- Produces collector routes `GET /v2/accounts`, `POST /v2/accounts/:platform/:platformId/collection/start`, and account-scoped collection status/events.
- Existing `/v1/session/*` and `/v1/collection/*` remain available for Xiaohongshu compatibility.

- [ ] **Step 1: Write failing multi-account route tests**

Assert three discovered accounts return independently, concurrent requests for different account keys run, duplicate requests for the same key return the existing run, and a failed Douyin account does not alter a Xiaohongshu run.

- [ ] **Step 2: Run collector and API tests and verify failure**

Run: `pnpm --filter collector test -- server.spec.ts platform-session-manager.spec.ts && pnpm --filter api test -- local-collector.service.spec.ts`

Expected: FAIL for missing V2 routes.

- [ ] **Step 3: Implement platform/account run keys**

Use `platformIdentityKey(platform, platformId)` for locks. Bound in-memory event buffers by the existing event count and byte limits. Keep bearer authentication, loopback binding, response validation, and constant-time token comparison unchanged.

- [ ] **Step 4: Import completed runs with Task 4**

Pass `{ platform, source: 'xiaohuohua', accountPlatformId, runId }` to `importPlatformCollection()`. Write a platform-aware sync job and notification with counts and incomplete content count.

- [ ] **Step 5: Run focused and regression tests**

Run: `pnpm --filter collector test && pnpm --filter api test && pnpm --filter api typecheck`

Expected: PASS, including all existing V1 route tests.

- [ ] **Step 6: Commit and push**

```bash
git add apps/collector/src apps/api/src/local-collector
git commit -m "feat: synchronize multiple platform accounts"
git push origin HEAD:main
```

---

### Task 8: Platform API, Filters, and Official Connector Seam

**Files:**
- Create: `apps/api/src/platforms/platforms.module.ts`
- Create: `apps/api/src/platforms/platforms.controller.ts`
- Create: `apps/api/src/platforms/platforms.service.ts`
- Create: `apps/api/src/platforms/platforms.service.spec.ts`
- Modify: `apps/api/src/app.module.ts`
- Modify: `apps/api/src/common/api.dto.ts`
- Modify: `apps/api/src/accounts/*`
- Modify: `apps/api/src/notes/*`
- Modify: `apps/api/src/comments/*`
- Modify: `apps/api/src/dashboard/*`
- Modify: `apps/api/src/reports/*`
- Modify: `apps/api/src/accounts/connector-registry.ts`

**Interfaces:**
- Produces `GET /platforms`, `GET /platforms/accounts/discovered`, and platform query parameter support on accounts, contents, comments, dashboard, reports, and exports.
- Retains `official` connector registration with `configured: false` until credentials exist.

- [ ] **Step 1: Write failing DTO and service tests**

```ts
expect(await service.listAccounts({ platform: 'douyin' })).toEqual(expect.arrayContaining([expect.objectContaining({ platform: 'douyin' })]));
expect(() => dtoPipe({ platform: 'kuaishou' })).toThrow();
```

Add an e2e assertion that `/dashboard?platform=all` returns separate `platforms.xiaohongshu` and `platforms.douyin` sections.

- [ ] **Step 2: Run API tests and verify failure**

Run: `pnpm --filter api test && pnpm --filter api test:e2e -- dashboard.e2e-spec.ts`

Expected: FAIL because platform filters are unsupported.

- [ ] **Step 3: Implement allowlisted platform filtering**

Accept only `all`, `xiaohongshu`, or `douyin`. Every account-scoped lookup must verify ownership after applying platform. Replace user-facing `xhsAccountId` assumptions with `platformAccountId`, retaining `xhsAccountId` as a deprecated response alias only for Xiaohongshu.

- [ ] **Step 4: Return mixed overview without invalid summation**

Return separate platform cards and compatible unified interaction cards. Never add Xiaohongshu views to Douyin views. Include platform/source with every content, metric, comment, report, and export record.

- [ ] **Step 5: Keep official API seams explicit**

Register `douyin-official` capabilities but return `configured: false` and no authorization URL until environment credentials pass validation. Do not make network calls from an unconfigured connector.

- [ ] **Step 6: Run API tests, e2e tests, and typecheck**

Run: `pnpm --filter api test && pnpm --filter api test:e2e && pnpm --filter api typecheck`

Expected: PASS.

- [ ] **Step 7: Commit and push**

```bash
git add apps/api/src apps/api/test
git commit -m "feat: expose platform-aware dashboard APIs"
git push origin HEAD:main
```

---

### Task 9: Platform-Safe Scheduling and Reports

**Files:**
- Modify: `apps/worker/src/sync/sync.scheduler.ts`
- Modify: `apps/worker/src/sync/sync.scheduler.spec.ts`
- Modify: `apps/worker/src/sync/sync.processor.ts`
- Modify: `apps/worker/src/report/report.service.ts`
- Modify: `apps/worker/src/report/report.service.spec.ts`
- Modify: `apps/worker/src/report/report.scheduler.ts`
- Modify: `apps/worker/src/report/report.scheduler.spec.ts`

**Interfaces:**
- Consumes platform/source from Account and metric definitions.
- Produces account/platform-scoped daily, weekly, monthly, and `previous_month_final` reports.

- [ ] **Step 1: Add failing scheduler matrix tests**

Test Aug 10 normal mode as `[2026-08-01, 2026-08-11)` and Aug 1 final mode as `[2026-07-01, 2026-08-01)`. Assert Aug 10 never schedules July for either platform. Assert one failed account does not prevent jobs for the others.

- [ ] **Step 2: Run worker tests and verify failure**

Run: `pnpm --filter worker test -- sync.scheduler.spec.ts report.service.spec.ts report.scheduler.spec.ts`

Expected: FAIL where source handling is hard-coded to `official`, `mock`, and `self-scrape`.

- [ ] **Step 3: Replace hard-coded source checks with source policy**

Create an internal source policy that selects definitions and snapshots by account platform and source. A report must never combine snapshot sequences from different sources unless an explicit metric definition declares them compatible; none do in this release.

- [ ] **Step 4: Preserve daily rows and monthly finalization**

Daily dashboard output contains every Shanghai date from month start through the requested business date/yesterday rule used by the current UI. Monthly final reports remain separate from daily rows and become immutable through the existing version/evidence fields.

- [ ] **Step 5: Run all worker tests and typecheck**

Run: `pnpm --filter worker test && pnpm --filter worker typecheck`

Expected: PASS for both platforms and all existing Xiaohongshu report tests.

- [ ] **Step 6: Commit and push**

```bash
git add apps/worker/src/sync apps/worker/src/report
git commit -m "feat: schedule platform-safe reports"
git push origin HEAD:main
```

---

### Task 10: Platform-Aware Exports

**Files:**
- Modify: `apps/api/src/notes/note-export.service.ts`
- Create: `apps/api/src/notes/note-export.service.spec.ts`
- Modify: `apps/api/src/comments/comments.service.ts`
- Modify: `apps/api/src/comments/comments.service.integration.spec.ts`
- Modify: `apps/web/app/api/notes/export/route.ts`
- Modify: `apps/web/app/api/comments/export/route.ts`
- Modify: `apps/web/components/note-export.tsx`
- Modify: `apps/web/components/comment-export.tsx`

**Interfaces:**
- Produces CSV/ZIP exports scoped by `platform`, `accountId`, `contentId`, and current filters.
- Every exported row includes platform, source, captured/observed time, and completeness state where applicable.

- [ ] **Step 1: Write failing export tests**

Assert a Douyin filter excludes Xiaohongshu rows, CSV escaping remains correct, comment replies contain parent IDs, and unknown metrics export empty values plus `not_provided` instead of zero.

- [ ] **Step 2: Run export tests and verify failure**

Run: `pnpm --filter api test -- note-export.service.spec.ts comments.service.integration.spec.ts && pnpm --filter web test -- note-export comment-export`

Expected: FAIL because platform columns and filters are missing.

- [ ] **Step 3: Implement platform-scoped export queries and filenames**

Use names such as `douyin-contents-2026-08-10.csv` and `all-platform-comments-2026-08-10.csv`. Apply the same validated filter set used by the visible page.

- [ ] **Step 4: Run focused tests and typechecks**

Run: `pnpm --filter api test && pnpm --filter web test && pnpm --filter api typecheck && pnpm --filter web typecheck`

Expected: PASS.

- [ ] **Step 5: Commit and push**

```bash
git add apps/api/src/notes apps/api/src/comments apps/web/app/api apps/web/components/note-export.tsx apps/web/components/comment-export.tsx
git commit -m "feat: export filtered multiplatform data"
git push origin HEAD:main
```

---

### Task 11: Mixed-Platform Dashboard and Shared Filters

**Files:**
- Create: `apps/web/components/platform-filter.tsx`
- Create: `apps/web/components/platform-filter.spec.tsx`
- Create: `apps/web/components/mixed-platform-overview.tsx`
- Create: `apps/web/components/mixed-platform-overview.spec.tsx`
- Modify: `apps/web/app/(dashboard)/dashboard/page.tsx`
- Modify: `apps/web/components/period-tabs.tsx`
- Modify: `apps/web/lib/api.ts`
- Modify: `apps/web/lib/api.spec.ts`
- Modify: `apps/web/app/globals.css`

**Interfaces:**
- Produces URL query state `platform=all|xiaohongshu|douyin` preserved across period and account changes.
- Renders separate Xiaohongshu and Douyin cards plus compatible cross-platform interaction metrics.

- [ ] **Step 1: Write failing component tests**

```tsx
render(<MixedPlatformOverview data={fixture} />);
expect(screen.getByText('小红书')).toBeInTheDocument();
expect(screen.getByText('抖音')).toBeInTheDocument();
expect(screen.queryByText('总浏览播放量')).not.toBeInTheDocument();
```

Assert platform selection retains `period` and clears an incompatible `accountId`.

- [ ] **Step 2: Run web tests and verify failure**

Run: `pnpm --filter web test -- platform-filter.spec.tsx mixed-platform-overview.spec.tsx`

Expected: FAIL because components are missing.

- [ ] **Step 3: Implement the approved mixed-overview layout**

Show both platform summaries on the default dashboard, clear platform labels, platform-specific metric labels, and one shared filter row. Keep daily rows visible and preserve mobile stacking without horizontal page overflow.

- [ ] **Step 4: Update API types and page copy**

Replace Xiaohongshu-only account labels with platform-aware labels. Rename aggregate navigation copy from “笔记” to “作品” while retaining “小红书笔记” inside Xiaohongshu-specific cards.

- [ ] **Step 5: Run tests, typecheck, and build**

Run: `pnpm --filter web test && pnpm --filter web typecheck && pnpm --filter web build`

Expected: PASS with no Next.js build overlay errors.

- [ ] **Step 6: Commit and push**

```bash
git add apps/web/components apps/web/app apps/web/lib
git commit -m "feat: add mixed-platform dashboard overview"
git push origin HEAD:main
```

---

### Task 12: Account, Content, and Comment User Flows

**Files:**
- Modify: `apps/web/app/(dashboard)/accounts/page.tsx`
- Modify: `apps/web/app/(dashboard)/accounts/page.spec.tsx`
- Modify: `apps/web/app/(dashboard)/notes/page.tsx`
- Modify: `apps/web/app/(dashboard)/notes/[id]/page.tsx`
- Modify: `apps/web/app/(dashboard)/comments/page.tsx`
- Modify: `apps/web/components/app-shell.tsx`
- Modify: `apps/web/components/app-shell.spec.tsx`
- Modify: `apps/web/components/note-explorer.tsx`
- Modify: `apps/web/components/all-note-comments.tsx`
- Modify: `apps/web/components/comment-tree.tsx`
- Modify: `apps/web/components/comment-completeness.tsx`

**Interfaces:**
- Consumes Task 8 APIs and Task 11 filter component.
- Produces multi-account discovery/sync controls, platform-tagged content, full comment trees, and visible completeness/error states.

- [ ] **Step 1: Add failing UI flow tests**

Test three Douyin accounts, independent sync buttons, one expired account, Xiaohongshu still usable, scheduled content absent, root/reply indentation, `partial` warning, and export URLs retaining filters.

- [ ] **Step 2: Run focused web tests and verify failure**

Run: `pnpm --filter web test -- accounts/page.spec.tsx app-shell.spec.tsx note-explorer comment-tree all-note-comments`

Expected: FAIL for missing platform UI.

- [ ] **Step 3: Implement account discovery and sync state**

Render avatar, name, platform account ID, platform badge, login state, last sync, and one sync control per account. A failed account displays its own recovery action without disabling other account controls.

- [ ] **Step 4: Implement content and complete comment presentation**

Render content by published timestamp descending, platform-specific metrics, nested replies, and explicit `complete`, `partial`, `failed`, or `not_available` labels. Never claim every comment is present for a non-complete state.

- [ ] **Step 5: Run web tests, typecheck, and build**

Run: `pnpm --filter web test && pnpm --filter web typecheck && pnpm --filter web build`

Expected: PASS.

- [ ] **Step 6: Commit and push**

```bash
git add apps/web/app/'(dashboard)' apps/web/components
git commit -m "feat: add multiplatform account content and comment flows"
git push origin HEAD:main
```

---

### Task 13: Notifications, Operational Status, and Failure Isolation

**Files:**
- Modify: `apps/worker/src/notification/notification.service.ts`
- Modify: `apps/worker/src/notification/notification.service.spec.ts`
- Modify: `apps/worker/src/notifications/event-producers.ts`
- Modify: `apps/api/src/settings/settings.service.ts`
- Modify: `apps/api/src/settings/settings.service.spec.ts`
- Modify: `apps/web/components/settings-overview.tsx`
- Modify: `apps/web/components/settings-overview.spec.tsx`

**Interfaces:**
- Produces platform/account-specific notifications for completed, partial, login-expired, rate-limited, page-changed, and failed runs.
- Settings health distinguishes dashboard collector, Xiaohuohua bridge, Xiaohongshu session, and Douyin sessions.

- [ ] **Step 1: Write failing notification and status tests**

Assert notification dedupe keys include platform/account/run, partial comment runs link to the affected content, expired Douyin login does not mark Xiaohongshu unhealthy, and no secret/query token appears in notification or audit details.

- [ ] **Step 2: Run tests and verify failure**

Run: `pnpm --filter worker test -- notification.service.spec.ts && pnpm --filter api test -- settings.service.spec.ts && pnpm --filter web test -- settings-overview.spec.tsx`

Expected: FAIL for missing platform-aware statuses.

- [ ] **Step 3: Implement platform-aware events and redaction**

Use event IDs `${platform}:${accountId}:${runId}:${eventType}`. Include safe error codes and stages only. Strip URL queries and reject details keys containing `password`, `cookie`, `token`, `secret`, or `qr`.

- [ ] **Step 4: Run focused and full tests**

Run: `pnpm --filter worker test && pnpm --filter api test && pnpm --filter web test`

Expected: PASS.

- [ ] **Step 5: Commit and push**

```bash
git add apps/worker/src/notification apps/worker/src/notifications apps/api/src/settings apps/web/components/settings-overview*
git commit -m "feat: report platform sync health and failures"
git push origin HEAD:main
```

---

### Task 14: End-to-End Migration, Browser QA, and Service Deployment

**Files:**
- Modify: `apps/api/test/dashboard.e2e-spec.ts`
- Create: `apps/api/test/multiplatform.e2e-spec.ts`
- Modify: `docker-compose.yml`
- Modify: `ops/macos/README.md`
- Modify: `ops/macos/xhs-services.test.sh`
- Modify: `INTEGRATION_PLAN.md`
- Modify: `XHS_API_AND_CONNECTOR_GUIDE.md`

**Interfaces:**
- Validates the complete approved user flow and updates the fixed background service deployment.

- [ ] **Step 1: Add failing end-to-end acceptance test**

Seed one Xiaohongshu account and three Douyin accounts, published content, metrics, complete/partial comments, and reports. Assert all-platform overview, platform filters, account filters, content ordering, unknown metric display, comment trees, and exports.

- [ ] **Step 2: Run the e2e test and verify failure before final wiring**

Run: `pnpm --filter api test:e2e -- multiplatform.e2e-spec.ts`

Expected: FAIL until every prior task is integrated into AppModule and web BFF routes.

- [ ] **Step 3: Wire environment and deployment settings**

Keep API and collectors loopback-only; expose only web port 3000 to LAN. Document opt-in Xiaohuohua bridge configuration, official API disabled state, JSON V2 format, current-month rule, first-day finalization, and recovery when Xiaohuohua login expires.

- [ ] **Step 4: Run complete automated verification**

Run:

```bash
pnpm test
pnpm typecheck
pnpm build
zsh ops/macos/xhs-services.test.sh
zsh ops/macos/docker-network-boundary.test.sh
zsh ops/macos/xhs-services.sh restart
zsh ops/macos/xhs-services.sh status
```

Expected: all tests/builds PASS and status reports PostgreSQL, Redis, web, API, and collector healthy.

- [ ] **Step 5: Run rendered browser QA**

Use the in-app Browser plugin at `http://127.0.0.1:3000`. Verify desktop and mobile flows: login → all-platform dashboard → Douyin filter → account → sync status → content → complete comments → export. Confirm URL/title, meaningful DOM, no framework overlay, no relevant console errors, screenshot evidence, and one interaction state change per page.

- [ ] **Step 6: Verify production data safety**

Run read-only SQL counts before and after migration for Account, Note, Comment, MetricSnapshot, and Report. Confirm existing Xiaohongshu UUID sets are identical and no row was deleted. Confirm the unrelated `.superpowers/sdd/2026-08-02-xiaohongshu-dashboard-implementation/task-5-report.md` modification remains untouched.

- [ ] **Step 7: Commit and push**

```bash
git add apps/api/test docker-compose.yml ops/macos INTEGRATION_PLAN.md XHS_API_AND_CONNECTOR_GUIDE.md
git commit -m "test: verify multiplatform dashboard end to end"
git push origin HEAD:main
```

- [ ] **Step 8: Final handoff**

Report the deployed local and LAN URLs, exact passing commands, migration row-count evidence, known platform-page fragility boundaries, official API configuration status, and whether every sampled content item has `complete` comments.
