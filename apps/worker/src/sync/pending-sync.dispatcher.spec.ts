import { describe, expect, it, vi } from 'vitest';

import { dispatchPendingSyncJobs } from './pending-sync.dispatcher';

describe('dispatchPendingSyncJobs', () => {
  it('enqueues each durable pending sync job with its database id', async () => {
    const store = {
      findPending: vi.fn().mockResolvedValue([
        { id: 'job-1', accountId: 'account-1' },
        { id: 'job-2', accountId: 'account-2' },
      ]),
    };
    const queue = { add: vi.fn().mockResolvedValue(undefined) };

    await dispatchPendingSyncJobs(store, queue);

    expect(queue.add).toHaveBeenCalledTimes(2);
    expect(queue.add).toHaveBeenNthCalledWith(1, 'sync-account', { accountId: 'account-1' }, expect.objectContaining({ jobId: 'job-1' }));
    expect(queue.add).toHaveBeenNthCalledWith(2, 'sync-account', { accountId: 'account-2' }, expect.objectContaining({ jobId: 'job-2' }));
  });
});
