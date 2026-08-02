import { describe, expect, it } from 'vitest';

import { accountSyncJobId, syncAccountJobOptions } from './queues';

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
});
