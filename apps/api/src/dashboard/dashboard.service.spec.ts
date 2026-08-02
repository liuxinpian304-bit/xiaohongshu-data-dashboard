import { describe, expect, it } from 'vitest';

import { DashboardService, type DashboardStore } from './dashboard.service';

const store: DashboardStore = {
  async read() {
    return {
      definitions: [
        { id: 'likes-id', key: 'likes' },
        { id: 'views-id', key: 'views' },
      ],
      snapshots: [
        { noteId: 'note-1', noteTitle: '第一条笔记', accountId: 'account-1', publishedAt: new Date('2025-12-01T00:00:00Z'), metricDefinitionId: 'likes-id', metricKey: 'likes', availability: 'available', value: '7', capturedAt: new Date('2025-12-29T04:00:00Z'), source: 'official' },
        { noteId: 'note-1', noteTitle: '第一条笔记', accountId: 'account-1', publishedAt: new Date('2025-12-01T00:00:00Z'), metricDefinitionId: 'likes-id', metricKey: 'likes', availability: 'available', value: '10', capturedAt: new Date('2025-12-30T04:00:00Z'), source: 'official' },
        { noteId: 'note-2', noteTitle: '第二条笔记', accountId: 'account-1', publishedAt: new Date('2025-12-02T00:00:00Z'), metricDefinitionId: 'likes-id', metricKey: 'likes', availability: 'zero', value: '0', capturedAt: new Date('2025-12-30T05:00:00Z'), source: 'official' },
      ],
      lastSyncedAt: new Date('2025-12-30T06:00:00Z'),
    };
  },
};

describe('DashboardService', () => {
  it('returns server-authoritative cross-year weekly boundaries and real metadata', async () => {
    const result = await new DashboardService(store).get('weekly', undefined, new Date('2026-01-05T04:00:00Z'));

    expect(result).toMatchObject({
      period: 'weekly',
      periodStart: '2025-12-28T16:00:00.000Z',
      periodEnd: '2026-01-04T15:59:59.999Z',
      source: 'official',
      lastSyncedAt: '2025-12-30T06:00:00.000Z',
    });
    expect(result.cards.find((card) => card.key === 'likes')).toMatchObject({ value: '10', availability: 'available' });
    expect(result.trend).toEqual([
      { date: '2025-12-29', metrics: [{ key: 'likes', value: '7', availability: 'available' }] },
      { date: '2025-12-30', metrics: [{ key: 'likes', value: '10', availability: 'available' }] },
    ]);
    expect(result.rankedNotes.map((note) => note.id)).toEqual(['note-1', 'note-2']);
  });

  it('keeps a successful empty dataset distinct from fabricated values', async () => {
    const emptyStore: DashboardStore = { async read() { return { definitions: [], snapshots: [], lastSyncedAt: null }; } };
    const result = await new DashboardService(emptyStore).get('monthly', undefined, new Date('2026-01-15T04:00:00Z'));

    expect(result).toMatchObject({
      periodStart: '2025-11-30T16:00:00.000Z',
      periodEnd: '2025-12-31T15:59:59.999Z',
      source: null,
      lastSyncedAt: null,
      cards: [],
      trend: [],
      rankedNotes: [],
    });
  });
});
