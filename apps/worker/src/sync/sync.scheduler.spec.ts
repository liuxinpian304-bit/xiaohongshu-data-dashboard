import { describe, expect, it, vi } from 'vitest';

import {
  PrismaRollingSyncAccountStore,
  enqueueRollingSyncTick,
  type RollingSyncAccountStore,
  type RollingSyncJobData,
} from './sync.scheduler';

function store(pages: Record<string, { items: Array<{ id: string }>; nextCursor?: string }>): RollingSyncAccountStore {
  return { listOfficialAccounts: async (cursor) => pages[cursor ?? 'start'] ?? { items: [] } };
}

function deduplicatingQueue() {
  const jobs = new Map<string, { name: string; data: RollingSyncJobData; options: { jobId?: string } }>();
  return {
    jobs,
    queue: {
      add: async (name: string, data: RollingSyncJobData, options: { jobId?: string }) => {
        if (options.jobId && !jobs.has(options.jobId)) jobs.set(options.jobId, { name, data, options });
        return { id: options.jobId };
      },
    },
  };
}

describe('enqueueRollingSyncTick', () => {
  it('enqueues stable per-account per-date official jobs without duplicating a repeated tick', async () => {
    const { jobs, queue } = deduplicatingQueue();
    const accounts = store({
      start: { items: [{ id: 'official-a' }], nextCursor: 'official-a' },
      'official-a': { items: [{ id: 'official-b' }] },
    });
    const now = new Date('2026-08-03T09:00:00+08:00');

    await enqueueRollingSyncTick(queue, accounts, now);
    const firstIds = [...jobs.keys()];
    await enqueueRollingSyncTick(queue, accounts, now);

    expect(jobs.size).toBe(4);
    expect([...jobs.keys()]).toEqual(firstIds);
    expect([...jobs.values()].map(({ data }) => data)).toEqual([
      { accountId: 'official-a', businessDate: '2026-08-01', windowStart: '2026-07-31T16:00:00.000Z', windowEndExclusive: '2026-08-01T16:00:00.000Z', mode: 'month_to_date', source: 'official' },
      { accountId: 'official-a', businessDate: '2026-08-02', windowStart: '2026-08-01T16:00:00.000Z', windowEndExclusive: '2026-08-02T16:00:00.000Z', mode: 'month_to_date', source: 'official' },
      { accountId: 'official-b', businessDate: '2026-08-01', windowStart: '2026-07-31T16:00:00.000Z', windowEndExclusive: '2026-08-01T16:00:00.000Z', mode: 'month_to_date', source: 'official' },
      { accountId: 'official-b', businessDate: '2026-08-02', windowStart: '2026-08-01T16:00:00.000Z', windowEndExclusive: '2026-08-02T16:00:00.000Z', mode: 'month_to_date', source: 'official' },
    ]);
  });

  it('fails closed before enqueue when an account pagination cursor repeats', async () => {
    const { jobs, queue } = deduplicatingQueue();
    const accounts = store({ start: { items: [{ id: 'official-a' }], nextCursor: 'loop' }, loop: { items: [{ id: 'official-b' }], nextCursor: 'loop' } });

    await expect(enqueueRollingSyncTick(queue, accounts, new Date('2026-08-03T09:00:00+08:00'))).rejects.toThrow('cursor');
    expect(jobs.size).toBe(0);
  });

  it('fails closed when a page cursor does not identify its last account', async () => {
    const { jobs, queue } = deduplicatingQueue();
    const accounts = store({ start: { items: [{ id: 'official-a' }], nextCursor: 'unrelated-account' } });

    await expect(enqueueRollingSyncTick(queue, accounts, new Date('2026-08-03T09:00:00+08:00'))).rejects.toThrow('cursor');
    expect(jobs.size).toBe(0);
  });

  it('continues with other accounts when one account cannot be enqueued', async () => {
    const accepted: string[] = [];
    const errors: unknown[] = [];
    const queue = { add: async (_name: string, data: RollingSyncJobData) => {
      if (data.accountId === 'official-a') throw new Error('redis shard unavailable');
      accepted.push(data.accountId);
      return {};
    } };

    await enqueueRollingSyncTick(queue, store({ start: { items: [{ id: 'official-a' }, { id: 'official-b' }] } }), new Date('2026-08-03T09:00:00+08:00'), (entry) => errors.push(entry));

    expect(accepted).toEqual(['official-b', 'official-b']);
    expect(errors).toHaveLength(1);
  });
});

describe('PrismaRollingSyncAccountStore', () => {
  it('requests only active authorized official accounts', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    await new PrismaRollingSyncAccountStore({ account: { findMany } } as never).listOfficialAccounts(undefined, 100, new Date('2026-08-03T01:00:00Z'));

    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        connectorType: 'official',
        credentials: { some: { OR: [{ expiresAt: null }, { expiresAt: { gt: new Date('2026-08-03T01:00:00Z') } }] } },
        capabilities: { some: { enabled: true } },
      }),
    }));
  });
});
