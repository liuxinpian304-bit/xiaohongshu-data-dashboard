import { QueueEvents } from 'bullmq';
import { afterEach, describe, expect, it } from 'vitest';

import { accountSyncJobId, createSyncAccountQueue, enqueueAccountSync, syncAccountJobOptions } from './queues';
import { createSyncWorker } from './sync/sync.processor';
import type { SyncService } from './sync/sync.service';

const resources: Array<{ close(): Promise<void> }> = [];

afterEach(async () => {
  await Promise.all(resources.splice(0).map((resource) => resource.close()));
});

describe('sync-account queue policy', () => {
  it('uses a stable account and business-date job id', () => {
    expect(accountSyncJobId('account-1', '2026-08-02')).toBe('sync:account-1:2026-08-02');
  });

  it('configures exponential retry with jitter for retryable failures', () => {
    expect(syncAccountJobOptions('account-1', '2026-08-02')).toEqual({
      jobId: 'sync:account-1:2026-08-02',
      attempts: 6,
      backoff: { type: 'exponential', delay: 1_000, jitter: 0.5 },
      removeOnComplete: true,
    });
  });

  it('preserves stable id and retry options through a real Redis enqueue', async () => {
    const queue = createSyncAccountQueue();
    resources.push(queue);
    await queue.obliterate({ force: true });

    const first = await enqueueAccountSync(queue, 'account-redis', '2026-08-02');
    const duplicate = await enqueueAccountSync(queue, 'account-redis', '2026-08-02');
    const stored = await queue.getJob(first.id!);

    expect(first.id).toBe('sync:account-redis:2026-08-02');
    expect(duplicate.id).toBe(first.id);
    expect(await queue.count()).toBe(1);
    expect(stored?.opts.attempts).toBe(6);
    expect(stored?.opts.backoff).toEqual({ type: 'exponential', delay: 1_000, jitter: 0.5 });
  });

  it('continues another account job after one account fails on the same Worker and Queue', async () => {
    const queue = createSyncAccountQueue();
    await queue.obliterate({ force: true });
    const events = new QueueEvents(queue.name, { connection: queue.opts.connection });
    const service = {
      async runAccountSync(jobId: string, accountId: string) {
        if (accountId === 'account-fail') throw Object.assign(new Error('unauthorized'), { status: 401 });
        return { jobId, accountId, status: 'complete' as const };
      },
    } as SyncService;
    const worker = createSyncWorker(service);
    resources.push(worker, events, queue);
    await Promise.all([worker.waitUntilReady(), events.waitUntilReady()]);

    const failed = await enqueueAccountSync(queue, 'account-fail', '2026-08-03');
    const successful = await enqueueAccountSync(queue, 'account-ok', '2026-08-03');
    const [failedResult, successfulResult] = await Promise.allSettled([
      failed.waitUntilFinished(events, 5_000),
      successful.waitUntilFinished(events, 5_000),
    ]);

    expect(failedResult.status).toBe('rejected');
    expect(successfulResult).toEqual({ status: 'fulfilled', value: { jobId: successful.id, accountId: 'account-ok', status: 'complete' } });
  });
});
