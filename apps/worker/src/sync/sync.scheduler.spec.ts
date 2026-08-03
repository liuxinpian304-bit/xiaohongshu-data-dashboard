import { describe, expect, it, vi } from 'vitest';

import {
  PrismaRollingSyncAccountStore,
  enqueueRollingSyncTick,
  type RollingSyncAccountStore,
  type RollingSyncJobData,
} from './sync.scheduler';

function store(pages: Record<string, { items: Array<{ id: string }>; hasMore: boolean; nextCursor?: string }>): RollingSyncAccountStore {
  return { listOfficialAccounts: async (cursor) => pages[cursor ?? 'start'] ?? { items: [], hasMore: false } };
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
      start: { items: [{ id: 'official-a' }], hasMore: true, nextCursor: 'official-a' },
      'official-a': { items: [{ id: 'official-b' }], hasMore: false },
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
    const accounts = store({ start: { items: [{ id: 'loop' }], hasMore: true, nextCursor: 'loop' }, loop: { items: [{ id: 'loop' }], hasMore: true, nextCursor: 'loop' } });

    await expect(enqueueRollingSyncTick(queue, accounts, new Date('2026-08-03T09:00:00+08:00'))).rejects.toThrow('cursor');
    expect(jobs.size).toBe(2);
  });

  it('fails closed when a page cursor does not identify its last account', async () => {
    const { jobs, queue } = deduplicatingQueue();
    const accounts = store({ start: { items: [{ id: 'official-a' }], hasMore: true, nextCursor: 'unrelated-account' } });

    await expect(enqueueRollingSyncTick(queue, accounts, new Date('2026-08-03T09:00:00+08:00'))).rejects.toThrow('cursor');
    expect(jobs.size).toBe(0);
  });

  it('fails closed when a page says more accounts exist but omits its cursor', async () => {
    const { jobs, queue } = deduplicatingQueue();
    await expect(enqueueRollingSyncTick(queue, store({ start: { items: [{ id: 'official-a' }], hasMore: true } }), new Date('2026-08-03T09:00:00+08:00'))).rejects.toThrow('cursor');
    expect(jobs.size).toBe(0);
  });

  it('continues with other accounts when one account cannot be enqueued', async () => {
    const accepted: string[] = [];
    const errors: unknown[] = [];
    const queue = { add: async (_name: string, data: RollingSyncJobData) => {
      if (data.accountId === 'official-a' && data.businessDate === '2026-08-01') throw new Error('redis shard unavailable');
      accepted.push(`${data.accountId}:${data.businessDate}`);
      return {};
    } };

    await enqueueRollingSyncTick(queue, store({ start: { items: [{ id: 'official-a' }, { id: 'official-b' }], hasMore: false } }), new Date('2026-08-03T09:00:00+08:00'), (entry) => errors.push(entry));

    expect(accepted).toEqual(expect.arrayContaining(['official-a:2026-08-02', 'official-b:2026-08-01', 'official-b:2026-08-02']));
    expect(errors).toEqual([expect.objectContaining({ accountId: 'official-a', businessDate: '2026-08-01', jobId: expect.any(String) })]);
  });

  it('finishes each account page before reading another and bounds queue concurrency', async () => {
    let active = 0; let maximumActive = 0; let firstPageCompleted = 0;
    const accounts: RollingSyncAccountStore = { listOfficialAccounts: async (cursor) => {
      if (cursor) {
        expect(firstPageCompleted).toBe(40);
        return { items: [{ id: 'last' }], hasMore: false };
      }
      return { items: Array.from({ length: 20 }, (_, index) => ({ id: `account-${index}` })), hasMore: true, nextCursor: 'account-19' };
    } };
    const queue = { add: async (_name: string, data: RollingSyncJobData) => {
      active += 1; maximumActive = Math.max(maximumActive, active);
      await Promise.resolve(); active -= 1;
      if (data.accountId !== 'last') firstPageCompleted += 1;
      return {};
    } };

    await enqueueRollingSyncTick(queue, accounts, new Date('2026-08-03T09:00:00+08:00'));
    expect(maximumActive).toBeGreaterThan(1);
    expect(maximumActive).toBeLessThanOrEqual(16);
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

  it.each([[100, false, undefined], [101, true, 'account-099']] as const)('uses a lookahead row for %s database results', async (count, hasMore, nextCursor) => {
    const rows = Array.from({ length: count }, (_, index) => ({ id: `account-${String(index).padStart(3, '0')}` }));
    const findMany = vi.fn().mockResolvedValue(rows);
    const result = await new PrismaRollingSyncAccountStore({ account: { findMany } } as never).listOfficialAccounts(undefined, 100, new Date());

    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 101 }));
    expect(result.items).toHaveLength(100);
    expect(result).toMatchObject({ hasMore, nextCursor });
  });
});
