import { afterEach, describe, expect, it } from 'vitest';

import { createReportQueue } from './report.processor';
import { DispatchStateConsistencyError, enqueueReportRebuild, enqueueScheduledReports, OwnershipLostError, PrismaAffectedReportStore, rebuildReportJob, ReportRebuildDispatcher, runScheduledReportTick } from './report.scheduler';
import { reportJobOptions, reportJobsForTick } from './report.scheduler';

const resources: Array<{ close(): Promise<void> }> = [];
afterEach(async () => Promise.all(resources.splice(0).map((resource) => resource.close())));

describe('reportJobsForTick', () => {
  it('enqueues daily and weekly reports on a Shanghai Monday only once per business date', () => {
    expect(reportJobsForTick(new Date('2026-08-02T16:05:00Z'))).toEqual([
      { name: 'generate-daily-report', jobId: 'report-daily-2026-08-03' },
      { name: 'generate-weekly-report', jobId: 'report-weekly-2026-08-03' },
    ]);
  });

  it('enqueues monthly reports only on the first Shanghai calendar day', () => {
    expect(reportJobsForTick(new Date('2026-08-31T16:05:00Z'))).toEqual([
      { name: 'generate-daily-report', jobId: 'report-daily-2026-09-01' },
      { name: 'generate-monthly-report', jobId: 'report-monthly-2026-09-01' },
    ]);
  });

  it('does not use the UTC date when Shanghai is already on the next day', () => {
    expect(reportJobsForTick(new Date('2026-08-02T15:59:00Z'))).toEqual([
      { name: 'generate-daily-report', jobId: 'report-daily-2026-08-02' },
    ]);
  });

  it('retains completed jobs long enough for restarts to reuse the stable job id', () => {
    expect(reportJobOptions('report-daily-2026-08-03')).toMatchObject({
      jobId: 'report-daily-2026-08-03',
      removeOnComplete: { age: 691_200 },
    });
  });

  it('creates a stable rebuild job for one backfill event', () => {
    expect(rebuildReportJob('weekly', new Date('2026-08-03T00:05:00+08:00'), 'snapshot-42')).toEqual({
      name: 'rebuild-report',
      data: { type: 'weekly', now: '2026-08-02T16:05:00.000Z' },
      options: expect.objectContaining({ jobId: 'report-rebuild-weekly-snapshot-42' }),
    });
  });

  it('enqueues a rebuild once through a real Redis queue', async () => {
    const queue = createReportQueue();
    resources.push(queue);
    await queue.obliterate({ force: true });

    const first = await enqueueReportRebuild(queue, 'daily', new Date('2026-08-03T00:05:00+08:00'), 'snapshot-42');
    const duplicate = await enqueueReportRebuild(queue, 'daily', new Date('2026-08-03T00:05:00+08:00'), 'snapshot-42');

    expect(first.id).toBe('report-rebuild-daily-snapshot-42');
    expect(duplicate.id).toBe(first.id);
    expect(await queue.count()).toBe(1);
  });

  it('does not duplicate scheduled jobs after a simulated service restart', async () => {
    const firstQueue = createReportQueue();
    resources.push(firstQueue);
    await firstQueue.obliterate({ force: true });
    await enqueueScheduledReports(firstQueue, new Date('2026-08-02T16:05:00Z'));
    await firstQueue.close();
    resources.splice(resources.indexOf(firstQueue), 1);
    const restartedQueue = createReportQueue();
    resources.push(restartedQueue);

    await enqueueScheduledReports(restartedQueue, new Date('2026-08-02T16:06:00Z'));

    expect(await restartedQueue.count()).toBe(2);
  });

  it('enqueues every awaiting daily weekly and monthly scope affected by a committed backfill', async () => {
    const queue = createReportQueue();
    resources.push(queue);
    await queue.obliterate({ force: true });
    const dispatcher = new ReportRebuildDispatcher({
      findAffectedReports: async () => [
        { id: 'daily-v1', accountId: 'account-1', type: 'daily', periodStart: new Date('2026-07-31T16:00:00Z'), periodEnd: new Date('2026-08-01T15:59:59.999Z') },
        { id: 'weekly-v1', accountId: 'account-1', type: 'weekly', periodStart: new Date('2026-07-26T16:00:00Z'), periodEnd: new Date('2026-08-02T15:59:59.999Z') },
        { id: 'monthly-v1', accountId: 'account-1', type: 'monthly', periodStart: new Date('2026-07-31T16:00:00Z'), periodEnd: new Date('2026-08-31T15:59:59.999Z') },
      ],
    }, queue);

    await dispatcher.handle({
      backfillId: 'backfill-42', accountId: 'account-1', noteId: 'note-1',
      capturedDates: ['2026-08-01'], reason: 'metric_snapshot_saved', claimToken: 'owner-42',
    });

    const jobs = await queue.getJobs();
    expect(jobs.map((job) => ({ name: job.name, accountId: job.data.accountId, previousReportId: job.data.previousReportId })).sort((a, b) => a.previousReportId!.localeCompare(b.previousReportId!))).toEqual([
      { name: 'rebuild-report', accountId: 'account-1', previousReportId: 'daily-v1' },
      { name: 'rebuild-report', accountId: 'account-1', previousReportId: 'monthly-v1' },
      { name: 'rebuild-report', accountId: 'account-1', previousReportId: 'weekly-v1' },
    ]);
    expect(new Set(jobs.map((job) => job.id)).size).toBe(3);
  });

  it('turns queue failures into a structured scheduler error instead of an unhandled rejection', async () => {
    const errors: unknown[] = [];
    const queue = { add: async () => { throw new Error('redis unavailable'); } };

    await runScheduledReportTick(queue, new Date('2026-08-02T16:05:00Z'), (entry) => errors.push(entry));

    expect(errors).toEqual([{
      service: 'worker', component: 'report-scheduler', event: 'enqueue_failed', error: 'redis unavailable',
    }]);
  });

  it('retries a pending outbox event and marks it dispatched without duplicate jobs', async () => {
    const queue = createReportQueue(); resources.push(queue); await queue.obliterate({ force: true });
    let first = true;
    const store = {
      findAffectedReports: async () => [{ id: 'daily-v1', accountId: 'account-1', type: 'daily' as const, periodStart: new Date('2026-07-31T16:00:00Z'), periodEnd: new Date('2026-08-01T15:59:59.999Z') }],
      claimPendingEvents: async () => [{ backfillId: 'backfill-retry', accountId: 'account-1', noteId: 'note-1', capturedDates: ['2026-08-01'], reason: 'metric_snapshot_saved', claimToken: 'retry-owner' }],
      markDispatchFailed: async () => {}, markDispatched: async () => {},
    };
    const failingQueue = { add: async (...args: Parameters<typeof queue.add>) => {
      if (first) { first = false; throw new Error('redis unavailable'); }
      return queue.add(...args);
    } };
    const dispatcher = new ReportRebuildDispatcher(store, failingQueue as never);
    await expect(dispatcher.handle((await store.claimPendingEvents())[0]!)).resolves.toBeUndefined();
    await dispatcher.dispatchPending();
    await dispatcher.dispatchPending();
    expect(await queue.count()).toBe(1);
  });

  it('isolates per-event state write failures and continues the claimed batch', async () => {
    const handled: string[] = []; const errors: unknown[] = [];
    const events = ['first', 'second'].map((backfillId) => ({ backfillId, accountId: 'a', noteId: 'n', capturedDates: ['2026-08-01'], reason: 'metric_snapshot_saved', claimToken: 'batch-owner' }));
    const dispatcher = new ReportRebuildDispatcher({
      claimPendingEvents: async () => events,
      findAffectedReports: async () => [],
      markDispatched: async (id) => { handled.push(id); if (id === 'first') throw new Error('state write failed'); },
      markDispatchFailed: async () => { throw new Error('failure write failed'); },
    }, { add: async () => ({}) } as never, (entry) => errors.push(entry));
    await expect(dispatcher.dispatchPending()).resolves.toBeUndefined();
    expect(handled).toEqual(['first', 'second']);
    expect(errors).toEqual(expect.arrayContaining([expect.objectContaining({ event: 'outbox_event_failed', backfillId: 'first' })]));
  });

  it('rejects a terminal write when the claim no longer owns the event', async () => {
    const store = new PrismaAffectedReportStore({
      backfillEvent: { updateMany: async () => ({ count: 0 }) },
    } as never);

    await expect(store.markDispatched('stale-event', 'stale-owner')).rejects.toBeInstanceOf(OwnershipLostError);
  });

  it('rejects a terminal write that updates more than one event', async () => {
    const store = new PrismaAffectedReportStore({
      backfillEvent: { updateMany: async () => ({ count: 2 }) },
    } as never);

    await expect(store.markDispatchFailed('duplicate-event', 'queue failed', 'owner')).rejects.toBeInstanceOf(DispatchStateConsistencyError);
  });

  it('logs a lost claim without a recursive failure write and continues the batch', async () => {
    const errors: unknown[] = []; const failed: string[] = []; const dispatched: string[] = [];
    const events = ['stale', 'current'].map((backfillId) => ({ backfillId, accountId: 'a', noteId: 'n', capturedDates: ['2026-08-01'], reason: 'metric_snapshot_saved', claimToken: `${backfillId}-owner` }));
    const dispatcher = new ReportRebuildDispatcher({
      claimPendingEvents: async () => events,
      findAffectedReports: async () => [],
      markDispatched: async (id) => {
        dispatched.push(id);
        if (id === 'stale') throw new OwnershipLostError(id);
      },
      markDispatchFailed: async (id) => { failed.push(id); },
    }, { add: async () => ({}) } as never, (entry) => errors.push(entry));

    await expect(dispatcher.dispatchPending()).resolves.toBeUndefined();

    expect(dispatched).toEqual(['stale', 'current']);
    expect(failed).toEqual([]);
    expect(errors).toEqual([expect.objectContaining({ event: 'claim_lost', backfillId: 'stale' })]);
  });

  it('logs a structured top-level claim failure and resolves for the next interval', async () => {
    const errors: unknown[] = [];
    const dispatcher = new ReportRebuildDispatcher({
      claimPendingEvents: async () => { throw new Error('database unavailable'); }, findAffectedReports: async () => [],
    }, { add: async () => ({}) } as never, (entry) => errors.push(entry));
    await expect(dispatcher.dispatchPending()).resolves.toBeUndefined();
    expect(errors).toEqual([{ service: 'worker', component: 'report-rebuild-outbox', event: 'claim_failed', error: 'database unavailable' }]);
  });
});
