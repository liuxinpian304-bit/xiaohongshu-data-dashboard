import { describe, expect, it } from 'vitest';
import { completedCollectionJobWhere, DashboardService, type DashboardStore } from './dashboard.service';

const snap = (overrides: Partial<any> = {}) => ({ noteId: 'note-1', noteTitle: '第一条笔记', accountId: 'account-1', publishedAt: new Date('2025-12-01T00:00:00Z'), metricDefinitionId: 'likes-id', metricKey: 'likes', aggregation: 'cumulative_delta', availability: 'available', value: '100', capturedAt: new Date('2025-12-28T10:00:00Z'), source: 'official', ...overrides });
const storeWith = (snapshots: any[], lastSyncedAt: Date | null = new Date('2026-01-04T06:00:00Z')): DashboardStore => ({ async isAuthorizedOfficialAccount() { return true; }, async read() { return { definitions: [{ id: 'likes-id', key: 'likes', displayName: '点赞', aggregation: 'cumulative_delta' }, { id: 'views-id', key: 'views', displayName: '访客', aggregation: 'cumulative_delta' }], snapshots, lastSyncedAt }; } });

describe('DashboardService', () => {
  it('only considers completed collection jobs for lastSyncedAt, never comment exports', () => {
    const now = new Date();
    expect(completedCollectionJobWhere('official', 'account-1', now)).toEqual(expect.objectContaining({ status: 'succeeded', currentStage: 'complete', accountId: 'account-1' }));
    expect(completedCollectionJobWhere('official', undefined, now)).not.toEqual(expect.objectContaining({ currentStage: 'export_comments' }));
  });
  it('uses the pre-period baseline for cross-year weekly deltas and cumulative daily trend', async () => {
    const store = storeWith([
      snap(), snap({ value: '107', capturedAt: new Date('2025-12-29T04:00:00Z') }), snap({ value: '110', capturedAt: new Date('2025-12-30T04:00:00Z') }),
      snap({ noteId: 'note-2', noteTitle: '第二条', value: '10' }), snap({ noteId: 'note-2', noteTitle: '第二条', value: '14', capturedAt: new Date('2025-12-30T05:00:00Z') }),
    ]);
    const result = await new DashboardService(store).get('weekly', undefined, 'official', new Date('2026-01-05T04:00:00Z'));
    expect(result).toMatchObject({ periodStart: '2025-12-28T16:00:00.000Z', periodEnd: '2026-01-04T15:59:59.999Z', source: 'official' });
    expect(result.cards.find(({ key }) => key === 'likes')).toMatchObject({ value: '14', availability: 'available' });
    expect(result.trend.map((point) => point.metrics.find(({ key }) => key === 'likes')?.value)).toEqual([null, '14']);
  });

  it.each([
    ['daily', new Date('2026-08-02T04:00:00Z'), '2026-07-31T15:00:00.000Z', '2026-08-01T12:00:00Z'],
    ['monthly', new Date('2026-02-15T04:00:00Z'), '2025-12-31T15:00:00.000Z', '2026-01-31T12:00:00Z'],
  ])('computes %s from a baseline before %s', async (period, now, baselineDate, endDate) => {
    const result = await new DashboardService(storeWith([snap({ capturedAt: new Date(baselineDate), value: '50' }), snap({ capturedAt: new Date(endDate), value: '58' })])).get(period, undefined, 'official', now);
    expect(result.cards.find(({ key }) => key === 'likes')?.value).toBe('8');
  });

  it('marks missing baselines unavailable and handles counter resets as post-reset additions', async () => {
    const result = await new DashboardService(storeWith([
      snap({ noteId: 'missing', capturedAt: new Date('2025-12-30T04:00:00Z'), value: '9' }),
      snap({ noteId: 'reset', value: '100' }), snap({ noteId: 'reset', capturedAt: new Date('2025-12-29T05:00:00Z'), value: '120' }), snap({ noteId: 'reset', capturedAt: new Date('2025-12-30T05:00:00Z'), value: '4' }),
    ])).get('weekly', undefined, 'official', new Date('2026-01-05T04:00:00Z'));
    expect(result.cards.find(({ key }) => key === 'likes')).toMatchObject({ value: null, availability: 'not_synced' });
    expect(result.rankedNotes).toEqual([expect.objectContaining({ id: 'reset', metricKey: 'likes', value: '24' })]);
  });

  it('uses one comparable metric for every ranked note', async () => {
    const result = await new DashboardService(storeWith([
      snap({ metricDefinitionId: 'views-id', metricKey: 'views', value: '10' }), snap({ metricDefinitionId: 'views-id', metricKey: 'views', value: '20', capturedAt: new Date('2025-12-30T04:00:00Z') }),
      snap({ noteId: 'note-2', metricDefinitionId: 'views-id', metricKey: 'views', value: '30' }), snap({ noteId: 'note-2', metricDefinitionId: 'views-id', metricKey: 'views', value: '36', capturedAt: new Date('2025-12-30T05:00:00Z') }),
      snap({ noteId: 'note-2', value: '1' }), snap({ noteId: 'note-2', value: '9', capturedAt: new Date('2025-12-30T05:00:00Z') }),
    ])).get('weekly', undefined, 'official', new Date('2026-01-05T04:00:00Z'));
    expect(new Set(result.rankedNotes.map(({ metricKey }) => metricKey))).toEqual(new Set(['views']));
    expect(result.rankedNotes[0]?.metricLabel).toBe('访客');
  });

  it('rejects mock and mixed source data', async () => {
    await expect(new DashboardService(storeWith([])).get('daily', undefined, 'mock')).rejects.toThrow('official');
    await expect(new DashboardService(storeWith([snap({ source: 'mock' })])).get('weekly', undefined, 'official', new Date('2026-01-05T04:00:00Z'))).rejects.toThrow('mixed');
  });

  it('rejects an invalid, expired, or inactive selected account instead of falling back', async () => {
    const store = storeWith([]); store.isAuthorizedOfficialAccount = async () => false;
    await expect(new DashboardService(store).get('daily', '00000000-0000-4000-8000-000000000001')).rejects.toThrow('active authorized');
  });

  it('applies explicit interval, period-end and safe deduplicated semantics', async () => {
    const at = (day: number) => new Date(`2025-12-${day}T04:00:00Z`);
    const result = await new DashboardService(storeWith([
      snap({ noteId: 'sum', metricDefinitionId: 'sum', metricKey: 'sum', aggregation: 'sum_interval', capturedAt: at(29), value: '3' }),
      snap({ noteId: 'sum', metricDefinitionId: 'sum', metricKey: 'sum', aggregation: 'sum_interval', capturedAt: at(30), value: '4' }),
      snap({ noteId: 'end', metricDefinitionId: 'end', metricKey: 'end', aggregation: 'period_end', capturedAt: at(29), value: '8' }),
      snap({ noteId: 'end', metricDefinitionId: 'end', metricKey: 'end', aggregation: 'period_end', capturedAt: at(30), value: '11' }),
      snap({ noteId: 'dedup', metricDefinitionId: 'dedup', metricKey: 'dedup', aggregation: 'deduplicated_period', capturedAt: at(30), value: '20' }),
    ])).get('weekly', undefined, 'official', new Date('2026-01-05T04:00:00Z'));
    expect(result.cards.find(({ key }) => key === 'sum')).toMatchObject({ value: '7', availability: 'available' });
    expect(result.cards.find(({ key }) => key === 'end')).toMatchObject({ value: '11', availability: 'available' });
    expect(result.cards.find(({ key }) => key === 'dedup')).toMatchObject({ value: null, availability: 'not_synced' });
  });

  it('keeps a successful empty dataset distinct from fabricated values', async () => {
    const result = await new DashboardService(storeWith([], null)).get('monthly', undefined, 'official', new Date('2026-01-15T04:00:00Z'));
    expect(result).toMatchObject({ source: 'official', lastSyncedAt: null, cards: [{ key: 'likes', value: null }, { key: 'views', value: null }], trend: [], rankedNotes: [] });
  });
});
