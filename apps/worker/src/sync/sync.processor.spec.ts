import { UnrecoverableError, type Job } from 'bullmq';
import { describe, expect, it } from 'vitest';

import { processSyncAccountJob, type SyncAccountJobData } from './sync.processor';
import type { SyncService } from './sync.service';

describe('sync account processor retry classification', () => {
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
