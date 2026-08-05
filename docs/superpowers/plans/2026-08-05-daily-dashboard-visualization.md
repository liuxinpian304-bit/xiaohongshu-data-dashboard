# Daily Dashboard Visualization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a daily dashboard that shows every completed Shanghai calendar day from the current month through yesterday, with a yesterday summary, switchable metric trend, and one comparison row per day.

**Architecture:** Keep the existing `/dashboard` endpoint and connector boundary. Extend the dashboard response with explicit daily rows computed server-side from evidence-aware metric aggregation; the Next.js page consumes that contract through focused presentational components. Weekly and monthly behavior stays independent and unchanged.

**Tech Stack:** TypeScript, NestJS, Prisma, Next.js 15, React 19, Vitest, Testing Library, CSS, in-app Browser QA.

## Global Constraints

- All calendar boundaries use `Asia/Shanghai`.
- Daily mode includes current-month day 1 through yesterday; it never includes today.
- Every completed day is present even when it has no successful snapshot.
- A missing metric remains unavailable and is never converted to zero.
- Weekly and monthly report semantics remain unchanged.
- Account selection applies to summary, trend, rows, and ranking consistently.
- Do not change the collector interface, QR login, or connector abstraction.
- Add no charting dependency; use code-native React and SVG.
- Preserve existing mock behavior and unrelated user changes.
- Commit and push every independently verified task.

## File Map

- `packages/domain/src/report-period.ts`: add the current-month completed-day window without changing the existing report period API.
- `packages/domain/src/report-period.spec.ts`: prove Shanghai day and month boundaries.
- `apps/api/src/dashboard/dashboard.service.ts`: build explicit daily rows and yesterday cards from authoritative metric evidence.
- `apps/api/src/dashboard/dashboard.service.spec.ts`: prove rows, sorting, gaps, availability, and unchanged weekly/monthly semantics.
- `apps/api/src/common/api.dto.ts`: document daily row response types.
- `apps/api/test/dashboard.e2e-spec.ts`: verify the public contract and OpenAPI schema.
- `apps/web/lib/api.ts`: type the extended response.
- `apps/web/components/daily-metric-overview.tsx`: render yesterday values and prior-day deltas.
- `apps/web/components/daily-metric-overview.spec.tsx`: cover value, delta, and unavailable states.
- `apps/web/components/daily-trend-explorer.tsx`: client-side metric switcher and SVG trend.
- `apps/web/components/daily-trend-explorer.spec.tsx`: cover switching and missing points.
- `apps/web/components/daily-metrics-table.tsx`: accessible newest-first daily comparison table.
- `apps/web/components/daily-metrics-table.spec.tsx`: cover columns, order, gaps, and delta labels.
- `apps/web/app/(dashboard)/dashboard/page.tsx`: compose the new daily mode while retaining weekly/monthly panels.
- `apps/web/app/globals.css`: implement desktop and mobile layout.

---

### Task 1: Current-Month Daily Window

**Files:**
- Modify: `packages/domain/src/report-period.ts`
- Test: `packages/domain/src/report-period.spec.ts`

**Interfaces:**
- Produces: `getCompletedMonthToDatePeriod(now: Date): ReportPeriod`
- Contract: `start` is Shanghai month day 1 at 00:00; `end` is yesterday at 23:59:59.999; when today is day 1, `end < start` represents an empty completed-day window.

- [ ] **Step 1: Write failing boundary tests**

```ts
expect(getCompletedMonthToDatePeriod(new Date('2026-08-05T01:00:00Z'))).toMatchObject({
  start: new Date('2026-07-31T16:00:00.000Z'),
  end: new Date('2026-08-04T15:59:59.999Z'),
});
expect(getCompletedMonthToDatePeriod(new Date('2026-08-01T04:00:00Z')).end.getTime())
  .toBeLessThan(getCompletedMonthToDatePeriod(new Date('2026-08-01T04:00:00Z')).start.getTime());
```

- [ ] **Step 2: Run the focused test and confirm failure**

Run: `pnpm --filter @xhs/domain test -- report-period.spec.ts`
Expected: FAIL because `getCompletedMonthToDatePeriod` is not exported.

- [ ] **Step 3: Implement the Shanghai month-to-yesterday helper**

Use `startOfMonth`, `startOfDay`, `subDays`, `endOfDay`, and `fromZonedTime`; do not alter `getReportPeriod('daily')`, because report generation still represents one daily report.

- [ ] **Step 4: Run domain tests**

Run: `pnpm --filter @xhs/domain test -- report-period.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit and push**

```bash
git add packages/domain/src/report-period.ts packages/domain/src/report-period.spec.ts
git commit -m "feat: define completed month daily window"
git push origin HEAD:main
```

### Task 2: Evidence-Aware Daily Dashboard Contract

**Files:**
- Modify: `apps/api/src/dashboard/dashboard.service.ts`
- Modify: `apps/api/src/common/api.dto.ts`
- Test: `apps/api/src/dashboard/dashboard.service.spec.ts`
- Test: `apps/api/test/dashboard.e2e-spec.ts`

**Interfaces:**
- Consumes: `getCompletedMonthToDatePeriod(now)` from Task 1.
- Produces: `dailyRows: DashboardDailyRowDto[]` on `DashboardResponseDto`.
- Produces row shape:

```ts
type DashboardDailyRow = {
  date: string;
  metrics: DashboardCard[];
  deltas: Array<{ key: string; value: string | null; availability: DataAvailability }>;
};
```

- [ ] **Step 1: Write failing service tests for all completed days**

Use `now = new Date('2026-08-05T04:00:00Z')`. Assert `dailyRows.map(row => row.date)` equals `['2026-08-01', '2026-08-02', '2026-08-03', '2026-08-04']`, including dates without snapshots. Assert an unavailable `views` metric stays `{ value: null, availability: 'not_provided' }`.

- [ ] **Step 2: Write failing tests for single-day values and comparison deltas**

Provide cumulative snapshots on consecutive days. Assert the 8 月 3 日 row contains only that day's increment, and its delta compares the 8 月 3 日 increment with the 8 月 2 日 increment. Assert the first row has null delta availability rather than an invented zero.

- [ ] **Step 3: Run focused API unit tests and confirm failure**

Run: `pnpm --filter api test -- src/dashboard/dashboard.service.spec.ts`
Expected: FAIL because `dailyRows` and month-to-date daily reads do not exist.

- [ ] **Step 4: Read the month-to-date evidence window only for daily mode**

In `DashboardService.get`, use the new window when `period === 'daily'`; keep `getReportPeriod` for weekly and monthly. The Prisma store must still include pre-window baselines for cumulative metrics.

- [ ] **Step 5: Implement one independent aggregation window per calendar day**

Build each day with Shanghai start/end instants. Call the existing evidence-aware `seriesDeltas` with that day's boundaries; do not subtract already aggregated cards. Build all configured metrics for every date so absent days remain visible.

- [ ] **Step 6: Implement prior-day comparison**

For each metric with usable values on both adjacent rows, set `delta.value = String(current - previous)`. Otherwise set `value: null` and preserve the most specific unavailable state. Keep rows chronological in the API; the UI owns newest-first presentation.

- [ ] **Step 7: Add DTOs and OpenAPI assertions**

Add `DashboardMetricDeltaDto` and `DashboardDailyRowDto`; add `dailyRows` to `DashboardResponseDto`. In E2E assertions, require `DashboardResponseDto.properties.dailyRows.items.$ref` and exact date/value/availability primitives.

- [ ] **Step 8: Run API unit, E2E, and type checks**

Run: `pnpm --filter api test && pnpm --filter api test:e2e && pnpm --filter api typecheck`
Expected: PASS.

- [ ] **Step 9: Commit and push**

```bash
git add apps/api/src/dashboard/dashboard.service.ts apps/api/src/dashboard/dashboard.service.spec.ts apps/api/src/common/api.dto.ts apps/api/test/dashboard.e2e-spec.ts
git commit -m "feat: expose daily dashboard rows"
git push origin HEAD:main
```

### Task 3: Daily Visualization Components

**Files:**
- Create: `apps/web/components/daily-metric-overview.tsx`
- Create: `apps/web/components/daily-metric-overview.spec.tsx`
- Create: `apps/web/components/daily-trend-explorer.tsx`
- Create: `apps/web/components/daily-trend-explorer.spec.tsx`
- Create: `apps/web/components/daily-metrics-table.tsx`
- Create: `apps/web/components/daily-metrics-table.spec.tsx`
- Modify: `apps/web/lib/api.ts`

**Interfaces:**
- Consumes: `DashboardDailyRow` from `apps/web/lib/api.ts`.
- Produces: `<DailyMetricOverview row previousDate />`, `<DailyTrendExplorer rows />`, and `<DailyMetricsTable rows />`.

- [ ] **Step 1: Add response types and failing component tests**

Test that overview renders `8月4日`, formatted metric values, `较前一天 +12`, and “暂无数据” for `not_provided`. Test that the table renders columns `日期 / 笔记 / 访客 / 点赞 / 评论 / 收藏 / 较前一天`, with 8 月 4 日 before 8 月 3 日.

- [ ] **Step 2: Add failing trend interaction test**

Render likes and comments data, click the exact `评论` metric control, then assert the chart accessible name changes to `评论每日趋势图` and its hidden table exposes comment values rather than likes values.

- [ ] **Step 3: Run focused web tests and confirm failure**

Run: `pnpm --filter web test -- daily-metric-overview.spec.tsx daily-trend-explorer.spec.tsx daily-metrics-table.spec.tsx`
Expected: FAIL because components do not exist.

- [ ] **Step 4: Implement overview and shared display helpers**

Use semantic articles and existing `formatMetric`. Render unavailable states with `DataAvailability`; render direction using arrow plus signed number, not color alone.

- [ ] **Step 5: Implement trend explorer**

Create a client component with four buttons: `访客`, `点赞`, `评论`, `收藏`. Draw only contiguous usable points; do not coerce null to zero. Provide an equivalent screen-reader table and a clear empty explanation.

- [ ] **Step 6: Implement newest-first daily table**

Copy and reverse rows before render to avoid mutating API data. Render compact per-cell deltas and one readable summary in the final column. Keep unavailable metric labels explicit.

- [ ] **Step 7: Run component tests and typecheck**

Run: `pnpm --filter web test -- daily-metric-overview.spec.tsx daily-trend-explorer.spec.tsx daily-metrics-table.spec.tsx && pnpm --filter web typecheck`
Expected: PASS.

- [ ] **Step 8: Commit and push**

```bash
git add apps/web/lib/api.ts apps/web/components/daily-*.tsx
git commit -m "feat: add daily dashboard visualizations"
git push origin HEAD:main
```

### Task 4: Dashboard Page Composition and Responsive Styling

**Files:**
- Modify: `apps/web/app/(dashboard)/dashboard/page.tsx`
- Modify: `apps/web/app/globals.css`
- Modify: `apps/web/app/(dashboard)/dashboard/loading.tsx`
- Test: existing and new tests under `apps/web/components/*.spec.tsx`

**Interfaces:**
- Consumes the three Task 3 components.
- Daily mode shows yesterday overview, metric switcher, and daily table.
- Weekly/monthly modes continue to show period cards, existing trend, completeness, ranking, and notifications.

- [ ] **Step 1: Add a failing composition assertion**

Extract a small pure `DailyDashboardContent` component if needed and test that daily mode exposes the landmarks `昨日概览`, `本月每日趋势`, and `每日数据明细`, while weekly/monthly content retains `核心指标趋势`.

- [ ] **Step 2: Run the test and confirm failure**

Run: `pnpm --filter web test`
Expected: FAIL on the new daily composition expectations.

- [ ] **Step 3: Compose daily mode without duplicating data logic**

Select the newest row for the overview. Pass the same `dashboard.dailyRows` array to trend and table. Rename the daily page heading to `每日数据`, and show the exact date range. Do not render misleading “官方” copy for unavailable self-scrape fields.

- [ ] **Step 4: Implement the visual hierarchy**

Use a clear first viewport: heading/filter, yesterday overview, trend explorer, then daily table. Use restrained red as the product accent, tabular numerals, strong date labels, subtle grid lines, and no decorative fake metrics.

- [ ] **Step 5: Implement responsive behavior**

At desktop widths, overview metrics fit one row and trend/table use full content width. At `max-width: 820px`, overview scrolls safely, trend controls wrap, and daily table sits in an `overflow-x:auto` container with a readable first column.

- [ ] **Step 6: Update loading skeleton and run full web verification**

Run: `pnpm --filter web test && pnpm --filter web typecheck && pnpm --filter web build`
Expected: PASS.

- [ ] **Step 7: Commit and push**

```bash
git add 'apps/web/app/(dashboard)/dashboard/page.tsx' 'apps/web/app/(dashboard)/dashboard/loading.tsx' apps/web/app/globals.css apps/web/components
git commit -m "feat: present daily dashboard clearly"
git push origin HEAD:main
```

### Task 5: Live Browser QA and Final Verification

**Files:**
- Modify only files required by defects found during QA.

**Interfaces:**
- Flow under test: `/dashboard?period=daily` → select trend metric/account → yesterday summary, trend, and every completed current-month day remain consistent.

- [ ] **Step 1: Restart clean dev services if needed**

Never run `next build` against the same `.next` directory while `next dev` is active. If a clean cache is needed, move the generated directory to a recoverable timestamped name before restart.

- [ ] **Step 2: Run in-app Browser desktop checks**

Verify URL/title, meaningful DOM, no framework overlay, relevant console errors/warnings, and screenshot evidence at the current desktop viewport. Confirm every date from month day 1 through yesterday appears once and today does not appear.

- [ ] **Step 3: Exercise interactions**

Switch from likes to comments and confirm chart label/data changes. Change account scope and confirm heading, row values, and trend share the same selection. Switch to monthly and confirm the daily table is absent.

- [ ] **Step 4: Run mobile visual checks**

Use a viewport near `390x844`; confirm no overlap, clipped controls, or page-level horizontal scroll. Verify the daily table's own horizontal scroll remains usable.

- [ ] **Step 5: Fix defects with focused regression tests**

For each defect, first add or update the smallest failing test, implement the fix, rerun that test, then repeat Browser evidence.

- [ ] **Step 6: Run final repository verification**

Run: `pnpm --filter @xhs/domain test && pnpm --filter api test && pnpm --filter api test:e2e && pnpm --filter api typecheck && pnpm --filter web test && pnpm --filter web typecheck && pnpm --filter web build`
Expected: every command exits 0.

- [ ] **Step 7: Commit and push final QA fixes**

```bash
git add 'apps/web/app/(dashboard)/dashboard/page.tsx' apps/web/app/globals.css apps/web/components/daily-*.tsx
git commit -m "fix: polish daily dashboard visualization"
git push origin HEAD:main
```

- [ ] **Step 8: Confirm clean scoped handoff**

Run: `git status --short` and confirm only pre-existing unrelated user files remain. Record the pushed commit IDs and Browser evidence in the final response.
