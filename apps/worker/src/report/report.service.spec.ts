import { describe, expect, it } from 'vitest';

import { ReportService, type ReportStore } from './report.service';

function storeWithSnapshots(snapshotDates: string[]): ReportStore {
  const versions: Array<{ version: number; status: string }> = [];
  return {
    listAccountIds: async () => ['account-1'],
    listNoteIds: async () => ['note-1'],
    listRequiredMetricDefinitions: async () => [{ key: 'views', id: 'views' }, { key: 'likes', id: 'likes' }, { key: 'comments', id: 'comments' }],
    loadCumulativeMetrics: async () => snapshotDates.flatMap((capturedAt, index) => ['views', 'likes', 'comments'].map((metricDefinitionId) => ({
      metricDefinitionId, noteId: 'note-1', capturedAt: new Date(capturedAt), value: 100 + index * 25,
    }))),
    createVersion: async (input) => {
      const version = versions.length + 1;
      versions.push({ version, status: input.status });
      return { id: `report-${version}`, accountId: input.accountId, version, status: input.status };
    },
  };
}

describe('ReportService', () => {
  it('marks a daily report awaiting data when its required day has no snapshot', async () => {
    const service = new ReportService(storeWithSnapshots([]));

    const report = await service.generateReport('daily', new Date('2026-08-02T08:00:00+08:00'));

    expect(report.status).toBe('awaiting_data');
    expect(report.missingDates).toEqual(['2026-08-01']);
    expect(report.reports[0]?.version).toBe(1);
  });

  it('creates a new complete version after missing snapshots are backfilled', async () => {
    const snapshots: string[] = [];
    const store = storeWithSnapshots(snapshots);
    const service = new ReportService(store);
    const now = new Date('2026-08-02T08:00:00+08:00');
    await service.generateReport('daily', now);
    snapshots.push('2026-08-01T00:15:00+08:00', '2026-08-01T23:45:00+08:00');

    const rebuilt = await service.generateReport('daily', now);

    expect(rebuilt.status).toBe('complete');
    expect(rebuilt.reports[0]?.version).toBe(2);
  });

  it('keeps a daily report awaiting data when only one cumulative snapshot exists', async () => {
    const service = new ReportService(storeWithSnapshots(['2026-08-01T12:00:00+08:00']));

    const report = await service.generateReport('daily', new Date('2026-08-02T08:00:00+08:00'));

    expect(report.status).toBe('awaiting_data');
    expect(report.missingDates).toEqual(['2026-08-01']);
  });

  it('sums each note first-to-last delta without mixing cumulative totals between notes', async () => {
    let savedMetrics: Array<{ metricDefinitionId: string; value: number }> = [];
    const store: ReportStore = {
      listAccountIds: async () => ['account-1'],
      listNoteIds: async () => ['note-a', 'note-b'],
      listRequiredMetricDefinitions: async () => [{ key: 'views', id: 'views' }],
      loadCumulativeMetrics: async () => [
        { metricDefinitionId: 'views', noteId: 'note-a', capturedAt: new Date('2026-08-01T00:15:00+08:00'), value: 100 },
        { metricDefinitionId: 'views', noteId: 'note-b', capturedAt: new Date('2026-08-01T00:20:00+08:00'), value: 1_000 },
        { metricDefinitionId: 'views', noteId: 'note-a', capturedAt: new Date('2026-08-01T23:40:00+08:00'), value: 130 },
        { metricDefinitionId: 'views', noteId: 'note-b', capturedAt: new Date('2026-08-01T23:45:00+08:00'), value: 1_050 },
      ],
      createVersion: async (input) => {
        savedMetrics = input.metrics;
        return { id: 'report-1', accountId: input.accountId, version: 1, status: input.status };
      },
    };

    await new ReportService(store).generateReport('daily', new Date('2026-08-02T08:00:00+08:00'));

    expect(savedMetrics).toEqual([{ metricDefinitionId: 'views', value: 80 }]);
  });

  it('reports a likes series that is entirely absent for an account note', async () => {
    const store: ReportStore = {
      listAccountIds: async () => ['account-1'],
      listNoteIds: async () => ['note-1'],
      listRequiredMetricDefinitions: async () => [{ key: 'views', id: 'views' }, { key: 'likes', id: 'likes' }],
      loadCumulativeMetrics: async () => [
        { metricDefinitionId: 'views', noteId: 'note-1', capturedAt: new Date('2026-08-01T00:15:00+08:00'), value: 100 },
        { metricDefinitionId: 'views', noteId: 'note-1', capturedAt: new Date('2026-08-01T23:45:00+08:00'), value: 120 },
      ],
      createVersion: async (input) => ({ id: 'report-1', accountId: input.accountId, version: 1, status: input.status }),
    };

    const report = await new ReportService(store).generateReport('daily', new Date('2026-08-02T08:00:00+08:00'));

    expect(report.missingFields).toEqual([
      { noteId: 'note-1', metricDefinitionId: 'likes', date: '2026-08-01' },
    ]);
    expect(report.missingDates).toEqual(['2026-08-01']);
    expect(report.status).toBe('awaiting_data');
  });

  it('records the exact missing day for a partially populated weekly series', async () => {
    const dates = ['2026-07-27', '2026-07-28', '2026-07-29', '2026-07-31', '2026-08-01', '2026-08-02'];
    const store: ReportStore = {
      listAccountIds: async () => ['account-1'],
      listNoteIds: async () => ['note-1'],
      listRequiredMetricDefinitions: async () => [{ key: 'likes', id: 'likes' }],
      loadCumulativeMetrics: async () => dates.flatMap((date, index) => [
        { metricDefinitionId: 'likes', noteId: 'note-1', capturedAt: new Date(`${date}T00:15:00+08:00`), value: index * 10 },
        { metricDefinitionId: 'likes', noteId: 'note-1', capturedAt: new Date(`${date}T23:45:00+08:00`), value: index * 10 + 1 },
      ]),
      createVersion: async (input) => ({ id: 'report-1', accountId: input.accountId, version: 1, status: input.status }),
    };

    const report = await new ReportService(store).generateReport('weekly', new Date('2026-08-03T08:00:00+08:00'));

    expect(report.missingFields).toEqual([
      { noteId: 'note-1', metricDefinitionId: 'likes', date: '2026-07-30' },
    ]);
  });

  it('accepts one daily snapshot per matrix cell when a weekly series has first and last points', async () => {
    const dates = ['2026-07-27', '2026-07-28', '2026-07-29', '2026-07-30', '2026-07-31', '2026-08-01', '2026-08-02'];
    const store: ReportStore = {
      listAccountIds: async () => ['account-1'], listNoteIds: async () => ['note-1'],
      listRequiredMetricDefinitions: async () => [{ key: 'views', id: 'views' }],
      loadCumulativeMetrics: async () => dates.map((date, value) => ({
        metricDefinitionId: 'views', noteId: 'note-1', capturedAt: new Date(`${date}T12:00:00+08:00`), value,
      })),
      createVersion: async (input) => ({ id: 'report-1', accountId: input.accountId, version: 1, status: input.status }),
    };

    const report = await new ReportService(store).generateReport('weekly', new Date('2026-08-03T08:00:00+08:00'));

    expect(report.status).toBe('complete');
    expect(report.missingFields).toEqual([]);
  });

  it('persists rebuild audit context on the new report version', async () => {
    let saved: Parameters<ReportStore['createVersion']>[0] | undefined;
    const store = storeWithSnapshots(['2026-08-01T00:15:00+08:00', '2026-08-01T23:45:00+08:00']);
    store.createVersion = async (input) => {
      saved = input;
      return { id: 'report-2', accountId: input.accountId, version: 2, status: input.status };
    };

    await new ReportService(store).generateReport('daily', new Date('2026-08-02T08:00:00+08:00'), {
      accountId: 'account-1', backfillId: 'backfill-42', rebuildJobId: 'report-rebuild-daily-backfill-42',
      previousReportId: 'report-v1', rebuildReason: 'metric_snapshot_backfilled',
    });

    expect(saved).toMatchObject({
      backfillId: 'backfill-42', rebuildJobId: 'report-rebuild-daily-backfill-42',
      previousReportId: 'report-v1', rebuildReason: 'metric_snapshot_backfilled',
    });
  });

  it('awaits data and identifies all required metric definitions when none exist', async () => {
    const store = storeWithSnapshots([]);
    store.listRequiredMetricDefinitions = async () => [
      { key: 'views' }, { key: 'likes' }, { key: 'comments' },
    ];
    const report = await new ReportService(store).generateReport('daily', new Date('2026-08-02T08:00:00+08:00'));
    expect(report.status).toBe('awaiting_data');
    expect(report.missingFields).toEqual([
      { noteId: 'note-1', metricKey: 'views', metricDefinitionId: null, date: '2026-08-01', reason: 'metric_definition_missing' },
      { noteId: 'note-1', metricKey: 'likes', metricDefinitionId: null, date: '2026-08-01', reason: 'metric_definition_missing' },
      { noteId: 'note-1', metricKey: 'comments', metricDefinitionId: null, date: '2026-08-01', reason: 'metric_definition_missing' },
    ]);
  });

  it('awaits data when exactly one required metric definition is missing', async () => {
    const store = storeWithSnapshots(['2026-08-01T00:15:00+08:00', '2026-08-01T23:45:00+08:00']);
    store.listRequiredMetricDefinitions = async () => [
      { key: 'views', id: 'views' }, { key: 'likes', id: 'likes' }, { key: 'comments' },
    ];
    const report = await new ReportService(store).generateReport('daily', new Date('2026-08-02T08:00:00+08:00'));
    expect(report.status).toBe('awaiting_data');
    expect(report.missingFields).toContainEqual({
      noteId: 'note-1', metricKey: 'comments', metricDefinitionId: null,
      date: '2026-08-01', reason: 'metric_definition_missing',
    });
  });

  it.each(['cumulative_delta', 'sum_interval', 'period_end', 'deduplicated_period'] as const)('generates a daily report only when %s semantic evidence is authoritative', async (aggregation) => {
    const start = new Date('2026-08-01T00:00:00+08:00'); const end = new Date('2026-08-02T00:00:00+08:00');
    let saved: Parameters<ReportStore['createVersion']>[0] | undefined;
    const evidence = aggregation === 'cumulative_delta'
      ? [{ capturedAt: new Date('2026-07-31T23:00:00+08:00'), value: 10 }, { capturedAt: new Date('2026-08-01T23:00:00+08:00'), value: 15 }]
      : [{ capturedAt: new Date('2026-08-01T23:00:00+08:00'), value: 5, windowStart: start, windowEnd: end, authoritativePeriod: true }];
    const store: ReportStore = {
      listAccountIds: async () => ['account-1'], listNoteIds: async () => ['note-1'],
      listRequiredMetricDefinitions: async () => [{ key: 'views', id: 'views', aggregation }],
      loadCumulativeMetrics: async () => evidence.map((item) => ({ metricDefinitionId: 'views', noteId: 'note-1', aggregation, aggregationVersion: 'official-v1', authoritativePeriod: false, ...item })),
      createVersion: async (input) => { saved = input; return { id: 'report', accountId: input.accountId, version: 1, status: input.status }; },
    };
    const report = await new ReportService(store).generateReport('daily', new Date('2026-08-02T08:00:00+08:00'));
    expect(report.status).toBe('complete'); expect(saved?.metrics).toEqual([{ metricDefinitionId: 'views', value: 5 }]);
  });

  it('does not write zero when deduplicated period evidence does not exactly match the report window', async () => {
    let saved: Parameters<ReportStore['createVersion']>[0] | undefined;
    const store: ReportStore = {
      listAccountIds: async () => ['account-1'], listNoteIds: async () => ['note-1'],
      listRequiredMetricDefinitions: async () => [{ key: 'views', id: 'views', aggregation: 'deduplicated_period' }],
      loadCumulativeMetrics: async () => [{ metricDefinitionId: 'views', noteId: 'note-1', aggregation: 'deduplicated_period', aggregationVersion: 'official-v1', capturedAt: new Date('2026-08-01T12:00:00+08:00'), value: 9, authoritativePeriod: true, windowStart: new Date('2026-08-01T01:00:00+08:00'), windowEnd: new Date('2026-08-01T23:59:59.999+08:00') }],
      createVersion: async (input) => { saved = input; return { id: 'report', accountId: input.accountId, version: 1, status: input.status }; },
    };
    const report = await new ReportService(store).generateReport('daily', new Date('2026-08-02T08:00:00+08:00'));
    expect(report.status).toBe('awaiting_data'); expect(saved?.metrics).toEqual([]); expect(report.missingFields).toContainEqual(expect.objectContaining({ reason: 'aggregation_unavailable' }));
  });

  it('does not complete an empty non-cumulative required metric matrix', async () => {
    let saved: Parameters<ReportStore['createVersion']>[0] | undefined;
    const store: ReportStore = {
      listAccountIds: async () => ['account-1'], listNoteIds: async () => ['note-1'],
      listRequiredMetricDefinitions: async () => [{ key: 'views', id: 'views', aggregation: 'sum_interval' }],
      loadCumulativeMetrics: async () => [],
      createVersion: async (input) => { saved = input; return { id: 'report', accountId: input.accountId, version: 1, status: input.status }; },
    };
    const report = await new ReportService(store).generateReport('daily', new Date('2026-08-02T08:00:00+08:00'));
    expect(report.status).toBe('awaiting_data'); expect(saved?.metrics).toEqual([]);
    expect(report.missingFields).toContainEqual(expect.objectContaining({ noteId: 'note-1', metricDefinitionId: 'views', reason: 'aggregation_unavailable' }));
  });

  it.each([
    ['weekly', new Date('2026-08-03T08:00:00+08:00'), new Date('2026-07-26T16:00:00Z'), new Date('2026-08-02T16:00:00.000Z')],
    ['monthly', new Date('2026-08-15T08:00:00+08:00'), new Date('2026-06-30T16:00:00Z'), new Date('2026-07-31T16:00:00.000Z')],
  ] as const)('honors authoritative period-end evidence for %s boundaries', async (type, now, start, end) => {
    const store: ReportStore = {
      listAccountIds: async () => ['account-1'], listNoteIds: async () => ['note-1'],
      listRequiredMetricDefinitions: async () => [{ key: 'views', id: 'views', aggregation: 'period_end' }],
      loadCumulativeMetrics: async () => [{ metricDefinitionId: 'views', noteId: 'note-1', aggregation: 'period_end', aggregationVersion: 'official-v1', capturedAt: new Date(end.getTime() - 1), value: 12, authoritativePeriod: true, windowStart: start, windowEnd: end }],
      createVersion: async (input) => ({ id: 'report', accountId: input.accountId, version: 1, status: input.status }),
    };
    expect((await new ReportService(store).generateReport(type, now)).status).toBe('complete');
  });
});
