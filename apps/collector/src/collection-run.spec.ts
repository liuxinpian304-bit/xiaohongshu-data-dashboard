import { describe, expect, it, vi } from 'vitest';

import { CollectionRun } from './collection-run';

type TestEvent = { version: 1; type: 'completed'; source: 'self-scrape'; runId: string; completedAt: string };

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

  it('keeps validated collection events scoped to their run without exposing them in status', async () => {
    const runner = new CollectionRun<TestEvent>({
      createRunId: () => 'run-4',
      collect: async (_progress, emit, runId) => {
        emit({ version: 1, type: 'completed', source: 'self-scrape', runId, completedAt: '2026-08-04T06:00:00.000Z' });
      },
    });

    runner.start();
    await vi.waitFor(() => expect(runner.status().state).toBe('completed'));

    expect(runner.events('run-4')).toEqual([
      { version: 1, type: 'completed', source: 'self-scrape', runId: 'run-4', completedAt: '2026-08-04T06:00:00.000Z' },
    ]);
    expect(JSON.stringify(runner.status())).not.toContain('completedAt');
    expect(() => runner.events('different-run')).toThrowError('collector_run_not_found');
  });

  it('discards partial events when collection fails', async () => {
    const runner = new CollectionRun<TestEvent>({
      createRunId: () => 'run-5',
      collect: async (_progress, emit, runId) => {
        emit({ version: 1, type: 'completed', source: 'self-scrape', runId, completedAt: '2026-08-04T06:00:00.000Z' });
        throw new Error('page changed');
      },
    });

    runner.start();
    await vi.waitFor(() => expect(runner.status().state).toBe('failed'));
    expect(runner.events('run-5')).toEqual([]);
  });
});
