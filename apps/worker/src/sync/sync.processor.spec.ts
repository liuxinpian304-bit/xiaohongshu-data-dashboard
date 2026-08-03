import { UnrecoverableError, type Job } from 'bullmq';
import { describe, expect, it } from 'vitest';

import { processSyncAccountJob, type SyncAccountJobData } from './sync.processor';
import type { SyncService } from './sync.service';

describe('sync account processor retry classification', () => {
  it('passes the complete official rolling-day payload to the sync service', async () => {
    const calls: unknown[][] = [];
    const service = { runAccountSync: async (...args: unknown[]) => { calls.push(args); return { jobId: 'rolling-job', accountId: 'account-1', status: 'complete' as const }; } } as unknown as SyncService;
    const rollingJob = { id: 'rolling-job', name: 'sync-account', data: {
      accountId: 'account-1', businessDate: '2026-08-01', windowStart: '2026-07-31T16:00:00.000Z',
      windowEndExclusive: '2026-08-01T16:00:00.000Z', mode: 'month_to_date', source: 'official',
    } } as Job<SyncAccountJobData>;
    await processSyncAccountJob(service, rollingJob);
    expect(calls).toEqual([['rolling-job', 'account-1', {
      businessDate: '2026-08-01', windowStart: '2026-07-31T16:00:00.000Z', windowEndExclusive: '2026-08-01T16:00:00.000Z', mode: 'month_to_date', source: 'official',
    }]]);
  });

  it.each([401, 403])('turns HTTP %s into an unrecoverable BullMQ failure', async (status) => {
    const error = Object.assign(new Error(`HTTP ${status}`), { status });
    const service = { runAccountSync: async () => { throw error; } } as unknown as SyncService;

    await expect(processSyncAccountJob(service, job('job-auth'))).rejects.toBeInstanceOf(UnrecoverableError);
  });

  it('leaves HTTP 429 retryable so BullMQ applies configured backoff', async () => {
    const error = Object.assign(new Error('rate limited'), { response: { status: 429 } });
    const service = { runAccountSync: async () => { throw error; } } as unknown as SyncService;

    await expect(processSyncAccountJob(service, job('job-rate'))).rejects.toBe(error);
  });
});

function job(id: string): Job<SyncAccountJobData> {
  return { id, name: 'sync-account', data: { accountId: 'account-1' } } as Job<SyncAccountJobData>;
}
