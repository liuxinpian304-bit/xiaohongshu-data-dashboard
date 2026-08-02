import { afterAll, describe, expect, it } from 'vitest';

import { createDatabaseClient } from '@xhs/database';

import { PrismaReportStore } from './report.service';
import { PrismaAffectedReportStore } from './report.scheduler';

const connectionString = process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:55432/xhs_dashboard';
const firstDb = createDatabaseClient(connectionString);
const secondDb = createDatabaseClient(connectionString);

describe('PrismaReportStore version allocation', () => {
  afterAll(async () => Promise.all([firstDb.$disconnect(), secondDb.$disconnect()]));

  it('allocates consecutive unique versions for the same scope over two independent connections', async () => {
    const account = await firstDb.account.create({ data: { connectorType: 'integration-report', platformId: crypto.randomUUID() } });
    const input = {
      accountId: account.id,
      type: 'daily' as const,
      periodStart: new Date('2026-08-01T00:00:00+08:00'),
      periodEnd: new Date('2026-08-01T23:59:59.999+08:00'),
      status: 'awaiting_data' as const,
      missingDates: ['2026-08-01'],
      missingFields: [{ noteId: crypto.randomUUID(), metricDefinitionId: crypto.randomUUID(), date: '2026-08-01' }],
      metrics: [],
    };

    const created = await Promise.all([
      new PrismaReportStore(firstDb).createVersion(input),
      new PrismaReportStore(secondDb).createVersion(input),
    ]);

    expect(created.map((report) => report.version).sort()).toEqual([1, 2]);
    expect(await firstDb.report.count({ where: { accountId: account.id } })).toBe(2);
    await firstDb.account.delete({ where: { id: account.id } });
  });

  it('does not merge version sequences for different report scopes', async () => {
    const account = await firstDb.account.create({ data: { connectorType: 'integration-report', platformId: crypto.randomUUID() } });
    const base = {
      accountId: account.id,
      periodStart: new Date('2026-08-01T00:00:00+08:00'),
      periodEnd: new Date('2026-08-01T23:59:59.999+08:00'),
      status: 'complete' as const, missingDates: [], missingFields: [], metrics: [],
    };

    const [daily, weekly] = await Promise.all([
      new PrismaReportStore(firstDb).createVersion({ ...base, type: 'daily' }),
      new PrismaReportStore(secondDb).createVersion({ ...base, type: 'weekly' }),
    ]);

    expect([daily.version, weekly.version]).toEqual([1, 1]);
    await firstDb.account.delete({ where: { id: account.id } });
  });

  it('stores the triggering rebuild audit on the replacement version', async () => {
    const account = await firstDb.account.create({ data: { connectorType: 'integration-report', platformId: crypto.randomUUID() } });
    const store = new PrismaReportStore(firstDb);
    const base = {
      accountId: account.id, type: 'daily' as const,
      periodStart: new Date('2026-08-01T00:00:00+08:00'), periodEnd: new Date('2026-08-01T23:59:59.999+08:00'),
      status: 'awaiting_data' as const, missingDates: ['2026-08-01'],
      missingFields: [{ noteId: crypto.randomUUID(), metricDefinitionId: crypto.randomUUID(), date: '2026-08-01' }], metrics: [],
    };
    await store.createVersion(base);
    const previous = await firstDb.report.findFirstOrThrow({ where: { accountId: account.id, version: 1 } });

    await store.createVersion({
      ...base, status: 'complete', missingDates: [], missingFields: [],
      backfillId: 'backfill-audit', rebuildJobId: 'report-rebuild-daily-backfill-audit',
      previousReportId: previous.id, rebuildReason: 'metric_snapshot_saved',
    });

    const rebuilt = await firstDb.report.findFirstOrThrow({ where: { accountId: account.id, version: 2 } });
    expect(rebuilt).toMatchObject({
      backfillId: 'backfill-audit', rebuildJobId: 'report-rebuild-daily-backfill-audit',
      previousReportId: previous.id, rebuildReason: 'metric_snapshot_saved',
    });
    await firstDb.account.delete({ where: { id: account.id } });
  });

  it('ignores a stale awaiting version when the latest report in its scope is complete', async () => {
    const account = await firstDb.account.create({ data: { connectorType: 'integration-report', platformId: crypto.randomUUID() } });
    const store = new PrismaReportStore(firstDb);
    const base = { accountId: account.id, type: 'daily' as const, periodStart: new Date('2026-08-01T00:00:00+08:00'), periodEnd: new Date('2026-08-01T23:59:59.999+08:00'), metrics: [] };
    await store.createVersion({ ...base, status: 'awaiting_data', missingDates: ['2026-08-01'], missingFields: [] });
    await store.createVersion({ ...base, status: 'complete', missingDates: [], missingFields: [] });
    const affected = await new PrismaAffectedReportStore(firstDb).findAffectedReports({ backfillId: 'bf', accountId: account.id, noteId: crypto.randomUUID(), capturedDates: ['2026-08-01'], reason: 'metric_snapshot_saved' });
    expect(affected).toEqual([]);
    await firstDb.account.delete({ where: { id: account.id } });
  });
});
