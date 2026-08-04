import { describe, expect, it, vi } from 'vitest';

import { CollectionRun } from './collection-run';

describe('CollectionRun', () => {
  it('starts one run and returns the same run while it is active', async () => {
    let finish!: () => void;
    const collect = vi.fn(() => new Promise<void>((resolve) => { finish = resolve; }));
    const runner = new CollectionRun({ collect, createRunId: () => 'run-1' });

    const first = runner.start();
    const second = runner.start();

    expect(first).toMatchObject({ runId: 'run-1', state: 'running', stage: 'account' });
    expect(second).toEqual(first);
    expect(collect).toHaveBeenCalledTimes(1);
    finish();
    await vi.waitFor(() => expect(runner.status()).toMatchObject({ state: 'completed', stage: 'complete' }));
  });

  it('publishes allowlisted progress without collected content', async () => {
    const runner = new CollectionRun({
      createRunId: () => 'run-2',
      collect: async (progress) => {
        progress({ stage: 'comments', processed: 7, total: 10, incompleteNotes: 1 });
      },
    });

    runner.start();
    await vi.waitFor(() => expect(runner.status().state).toBe('completed'));

    expect(JSON.stringify(runner.status())).not.toMatch(/content|cookie|storage|selector|url/i);
  });

  it('maps collection failures to a fixed redacted error code', async () => {
    const runner = new CollectionRun({
      createRunId: () => 'run-3',
      collect: async () => { throw new Error('secret selector and response body'); },
    });

    runner.start();
    await vi.waitFor(() => expect(runner.status()).toMatchObject({
      state: 'failed', errorCode: 'collector_collection_failed',
    }));
    expect(JSON.stringify(runner.status())).not.toContain('secret selector');
  });
});
