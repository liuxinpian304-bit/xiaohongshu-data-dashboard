import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import type { XhsConnector } from '@xhs/connector';
import { MockXhsConnector } from '@xhs/connector';
import { prisma } from '@xhs/database';

import { SyncRepository } from './sync.repository';
import { SyncService } from './sync.service';
import { createReportQueue } from '../report/report.processor';
import { OwnershipLostError, PrismaAffectedReportStore, ReportRebuildDispatcher } from '../report/report.scheduler';

class FaultInjectingConnector implements XhsConnector {
  private commentPages = 0;
  private failAt: number | null = null;

  constructor(private readonly inner: XhsConnector) {}

  failAfterPage(page: number) { this.failAt = page + 1; }
  stopFailing() { this.failAt = null; }

  getCapabilities() { return this.inner.getCapabilities(); }
  beginAuthorization(input: Parameters<XhsConnector['beginAuthorization']>[0]) { return this.inner.beginAuthorization(input); }
  completeAuthorization(input: Parameters<XhsConnector['completeAuthorization']>[0]) { return this.inner.completeAuthorization(input); }
  listNotes(input: Parameters<XhsConnector['listNotes']>[0]) { return this.inner.listNotes(input); }
  getNoteMetrics(input: Parameters<XhsConnector['getNoteMetrics']>[0]) { return this.inner.getNoteMetrics(input); }
  listReplies(input: Parameters<XhsConnector['listReplies']>[0]) { return this.inner.listReplies(input); }
  refreshCredential(input: Parameters<XhsConnector['refreshCredential']>[0]) { return this.inner.refreshCredential(input); }

  async listComments(input: Parameters<XhsConnector['listComments']>[0]) {
    this.commentPages += 1;
    if (this.commentPages === this.failAt) throw new Error('injected page failure');
    return this.inner.listComments(input);
  }
}

describe('SyncService', () => {
  const repository = new SyncRepository(prisma);

  beforeEach(async () => {
    await prisma.commentSyncCompleteness.deleteMany();
    await prisma.reportMetric.deleteMany();
    await prisma.report.deleteMany();
    await prisma.syncCheckpoint.deleteMany();
    await prisma.syncStep.deleteMany();
    await prisma.syncJob.deleteMany();
    await prisma.comment.deleteMany();
    await prisma.$executeRawUnsafe('TRUNCATE TABLE "MetricSnapshot" CASCADE');
    await prisma.metricDefinition.deleteMany();
    await prisma.note.deleteMany();
    await prisma.connectorCapability.deleteMany();
    await prisma.credential.deleteMany();
    await prisma.account.deleteMany();
  });

  afterAll(async () => prisma.$disconnect());

  it('resumes comments from the persisted cursor after a retry', async () => {
    const account = await prisma.account.create({
      data: { connectorType: 'mock', platformId: 'account-1', displayName: 'Account 1' },
    });
    const connector = new FaultInjectingConnector(new MockXhsConnector());
    const service = new SyncService(connector, repository);

    connector.failAfterPage(2);
    await expect(service.runAccountSync('job-1', account.id)).rejects.toThrow('injected page failure');
    expect(await repository.countComments('note-1')).toBe(10);
    expect(await repository.getCommentCompleteness('mock', account.id, 'note-1')).toBe('failed');

    connector.stopFailing();
    await service.runAccountSync('job-1', account.id);

    expect(await repository.countComments('note-1')).toBe(12);
    expect(await repository.getCommentCursor('job-1', 'note-1')).toBeNull();
    expect(await repository.getCommentCompleteness('mock', account.id, 'note-1')).toBe('page_complete');
  });

  it('keeps comments idempotent when a completed job is run again', async () => {
    const account = await prisma.account.create({ data: { connectorType: 'mock', platformId: 'account-1' } });
    const service = new SyncService(new MockXhsConnector(), repository);

    await service.runAccountSync('job-idempotent', account.id);
    await service.runAccountSync('job-idempotent', account.id);

    expect(await repository.countComments('note-1')).toBe(12);
  });

  it('publishes completed and new-comment events at real sync boundaries', async () => {
    const account = await prisma.account.create({ data: { connectorType: 'mock', platformId: 'account-1' } });
    await new SyncService(new MockXhsConnector(), repository).runAccountSync('job-notification-baseline', account.id);
    const events: Array<{ id: string; type: string }> = [];
    const publisher = { publish: async (event: { id: string; type: string }) => { events.push(event); } };
    const inner = new MockXhsConnector();
    const connector = new FaultInjectingConnector(inner);
    connector.listComments = async (input) => {
      const page = await inner.listComments(input);
      return input.noteId === 'note-1' && input.cursor === null ? { ...page, items: [...page.items, {
        platformId: 'comment-note-1-new', noteId: 'note-1', authorName: 'New user', content: 'New comment',
        createdAt: new Date().toISOString(), source: 'mock' as const,
      }] } : page;
    };
    const service = new SyncService(connector, repository, publisher);
    expect((service as unknown as { notifications: unknown }).notifications).toBe(publisher);
    await service.runAccountSync('job-notifications', account.id);
    expect(new Set(events.filter(({ type }) => type === 'new_comment').map(({ id }) => id)).size).toBe(1);
    expect(events.at(-1)?.type).toBe('sync_completed');
  });

  it('publishes a persistent backfill event only after metric snapshots commit', async () => {
    const observed: string[] = [];
    const eventRepository = new SyncRepository(prisma, async (event) => {
      const persisted = await prisma.backfillEvent.findUnique({ where: { id: event.backfillId } });
      if (persisted) observed.push(event.backfillId);
    });
    const account = await prisma.account.create({ data: { connectorType: 'mock', platformId: 'account-1' } });

    await new SyncService(new MockXhsConnector(), eventRepository).runAccountSync('job-backfill', account.id);

    expect(observed.length).toBeGreaterThan(0);
    expect(await prisma.backfillEvent.count({ where: { id: { in: observed } } })).toBe(observed.length);
  });

  it('keeps metric sync successful when dispatch fails and recovers the persisted outbox through real Redis', async () => {
    const queue = createReportQueue(); await queue.obliterate({ force: true });
    const store = new PrismaAffectedReportStore(prisma);
    const failingDispatcher = new ReportRebuildDispatcher(store, { add: async () => { throw new Error('redis unavailable'); } } as never);
    const account = await prisma.account.create({ data: { connectorType: 'mock', platformId: 'account-1' } });
    const note = await prisma.note.create({ data: { accountId: account.id, connectorType: 'mock', platformId: 'note-1', title: 'Note 1', publishedAt: new Date('2026-07-01') } });
    const metrics = await new MockXhsConnector().getNoteMetrics({ noteId: 'note-1' });
    const capturedDate = metrics[0]!.capturedAt.slice(0, 10);
    await prisma.report.create({ data: {
      accountId: account.id, reportType: 'daily', periodStart: new Date(`${capturedDate}T00:00:00+08:00`),
      periodEnd: new Date(`${capturedDate}T23:59:59.999+08:00`), status: 'awaiting_data', missingDates: [capturedDate],
    } });
    const repository = new SyncRepository(prisma, () => failingDispatcher.dispatchPending());
    await repository.startJob('job-outbox', account.id);
    await expect(repository.saveMetrics('job-outbox', 'mock', note.platformId, metrics)).resolves.toBeUndefined();
    const failed = await prisma.backfillEvent.findFirstOrThrow({ where: { accountId: account.id } });
    expect(failed).toMatchObject({ dispatchStatus: 'failed', attempts: 1, lastError: 'redis unavailable', dispatchedAt: null });

    await prisma.report.create({ data: {
      accountId: account.id, reportType: 'daily', periodStart: new Date(`${capturedDate}T00:00:00+08:00`),
      periodEnd: new Date(`${capturedDate}T23:59:59.999+08:00`), version: 2, status: 'awaiting_data', missingDates: [capturedDate],
    } });
    await Promise.all([
      new ReportRebuildDispatcher(new PrismaAffectedReportStore(prisma), queue).dispatchPending(),
      new ReportRebuildDispatcher(new PrismaAffectedReportStore(prisma), queue).dispatchPending(),
    ]);
    const recovered = await prisma.backfillEvent.findUniqueOrThrow({ where: { id: failed.id } });
    expect(recovered).toMatchObject({ dispatchStatus: 'dispatched', attempts: 2, lastError: null });
    expect(recovered.dispatchedAt).not.toBeNull();
    await prisma.report.create({ data: {
      accountId: account.id, reportType: 'daily', periodStart: new Date(`${capturedDate}T00:00:00+08:00`),
      periodEnd: new Date(`${capturedDate}T23:59:59.999+08:00`), version: 3, status: 'awaiting_data', missingDates: [capturedDate],
    } });
    await prisma.backfillEvent.update({ where: { id: failed.id }, data: {
      dispatchStatus: 'processing', claimToken: 'crashed-worker', claimedAt: new Date(Date.now() - 10 * 60_000), dispatchedAt: null,
    } });
    await new ReportRebuildDispatcher(store, queue).dispatchPending();
    expect(await queue.count()).toBe(1);
    await queue.close();
  });

  it('allows only the current claim owner to complete a processing outbox event', async () => {
    const account = await prisma.account.create({ data: { connectorType: 'mock', platformId: 'claim-owner-account' } });
    const note = await prisma.note.create({ data: { accountId: account.id, connectorType: 'mock', platformId: 'claim-owner-note', title: 'Claim owner note', publishedAt: new Date('2026-08-01') } });
    const event = await prisma.backfillEvent.create({ data: {
      id: 'claim-owner-event', accountId: account.id, noteId: note.id, capturedDates: ['2026-08-01'],
      dispatchStatus: 'processing', claimToken: 'current-owner', claimedAt: new Date(),
    } });
    const store = new PrismaAffectedReportStore(prisma);

    await expect((store as unknown as { markDispatched(id: string): Promise<void> }).markDispatched(event.id)).rejects.toBeInstanceOf(OwnershipLostError);
    await expect(store.markDispatchFailed(event.id, 'stale failure', 'wrong-owner')).rejects.toBeInstanceOf(OwnershipLostError);

    expect(await prisma.backfillEvent.findUniqueOrThrow({ where: { id: event.id } })).toMatchObject({
      dispatchStatus: 'processing', claimToken: 'current-owner', attempts: 0, lastError: null,
    });
  });

  it('prevents a stale lease owner from overwriting the dispatcher that reclaimed the event', async () => {
    const account = await prisma.account.create({ data: { connectorType: 'mock', platformId: 'stale-owner-account' } });
    const note = await prisma.note.create({ data: { accountId: account.id, connectorType: 'mock', platformId: 'stale-owner-note', title: 'Stale owner note', publishedAt: new Date('2026-08-01') } });
    const event = await prisma.backfillEvent.create({ data: {
      id: 'stale-owner-event', accountId: account.id, noteId: note.id, capturedDates: ['2026-08-01'],
      dispatchStatus: 'processing', claimToken: 'stale-owner', claimedAt: new Date('2026-08-01T00:00:00Z'),
    } });
    const store = new PrismaAffectedReportStore(prisma);
    await store.claimPendingEvents('current-owner', new Date('2026-08-01T00:10:00Z'));

    await expect(store.markDispatched(event.id, 'stale-owner')).rejects.toBeInstanceOf(OwnershipLostError);

    expect(await prisma.backfillEvent.findUniqueOrThrow({ where: { id: event.id } })).toMatchObject({
      dispatchStatus: 'processing', claimToken: 'current-owner', attempts: 0,
    });
  });

  it('marks a job unverifiable and stops when the connector repeats a cursor', async () => {
    const account = await prisma.account.create({ data: { connectorType: 'mock', platformId: 'account-1' } });
    const inner = new MockXhsConnector();
    const connector: XhsConnector = {
      ...inner,
      getCapabilities: inner.getCapabilities.bind(inner),
      beginAuthorization: inner.beginAuthorization.bind(inner),
      completeAuthorization: inner.completeAuthorization.bind(inner),
      listNotes: inner.listNotes.bind(inner),
      getNoteMetrics: inner.getNoteMetrics.bind(inner),
      listReplies: inner.listReplies.bind(inner),
      refreshCredential: inner.refreshCredential.bind(inner),
      async listComments(input) {
        const page = await inner.listComments(input);
        return input.cursor ? { ...page, nextCursor: input.cursor, hasMore: true } : page;
      },
    };

    const result = await new SyncService(connector, repository).runAccountSync('job-loop', account.id);
    const job = await prisma.syncJob.findUniqueOrThrow({ where: { externalJobId: 'job-loop' } });

    expect(result.status).toBe('unverifiable');
    expect(job.verificationStatus).toBe('unverifiable');
    expect(await repository.countComments('note-1')).toBe(10);
    expect(await repository.getCommentCompleteness('mock', account.id, 'note-1')).toBe('unverifiable');
  });

  it('does not advance to later stages after a repeated notes cursor', async () => {
    const account = await prisma.account.create({ data: { connectorType: 'mock', platformId: 'account-1' } });
    const inner = new MockXhsConnector();
    const connector = new FaultInjectingConnector(inner);
    connector.listNotes = async (input) => {
      const page = await inner.listNotes(input);
      return { ...page, nextCursor: input.cursor ?? 'MA==', hasMore: true };
    };

    const result = await new SyncService(connector, repository).runAccountSync('job-notes-loop', account.id);

    expect(result.status).toBe('unverifiable');
    expect(await prisma.metricSnapshot.count()).toBe(0);
    expect(await prisma.comment.count()).toBe(0);
  });

  it('records authorization_required without requesting comments when capability is unavailable', async () => {
    const account = await prisma.account.create({ data: { connectorType: 'mock', platformId: 'account-1' } });
    const inner = new MockXhsConnector();
    const connector: XhsConnector = {
      getCapabilities: async () => ({ ...(await inner.getCapabilities()), comments: false }),
      beginAuthorization: inner.beginAuthorization.bind(inner),
      completeAuthorization: inner.completeAuthorization.bind(inner),
      listNotes: inner.listNotes.bind(inner),
      getNoteMetrics: inner.getNoteMetrics.bind(inner),
      listComments: async () => { throw new Error('comments must not be requested'); },
      listReplies: inner.listReplies.bind(inner),
      refreshCredential: inner.refreshCredential.bind(inner),
    };

    const events: Array<{ type: string }> = [];
    await new SyncService(connector, repository, { publish: async (event) => { events.push(event); } }).runAccountSync('job-no-comments', account.id);

    expect(await repository.getCommentCompleteness('mock', account.id, 'note-1')).toBe('authorization_required');
    expect(await repository.countComments('note-1')).toBe(0);
    expect(events.some(({ type }) => type === 'comment_sync_incomplete')).toBe(true);
  });

  it.each([[401, 'authorization_expired'], [500, 'sync_failed']] as const)('publishes the classified sync failure for HTTP %s', async (status, type) => {
    const account = await prisma.account.create({ data: { connectorType: 'mock', platformId: 'account-1' } });
    const inner = new MockXhsConnector();
    const connector = { ...inner, getCapabilities: async () => { throw Object.assign(new Error('connector failed'), { status }); } } as unknown as XhsConnector;
    const events: Array<{ type: string }> = [];
    await expect(new SyncService(connector, repository, { publish: async (event) => { events.push(event); } }).runAccountSync(`job-failure-${status}`, account.id)).rejects.toThrow('connector failed');
    expect(events.at(-1)?.type).toBe(type);
  });

  it('isolates notes with the same platform id across connectors', async () => {
    const officialAccount = await prisma.account.create({ data: { connectorType: 'official', platformId: 'official-account' } });
    const officialNote = await prisma.note.create({
      data: { accountId: officialAccount.id, connectorType: 'official', platformId: 'note-1', title: 'Official note', publishedAt: new Date('2026-07-01') },
    });
    const mockAccount = await prisma.account.create({ data: { connectorType: 'mock', platformId: 'account-1' } });

    await new SyncService(new MockXhsConnector(), repository).runAccountSync('job-isolated', mockAccount.id);

    expect(await prisma.comment.count({ where: { noteId: officialNote.id } })).toBe(0);
    expect(await prisma.comment.count({ where: { note: { connectorType: 'mock', platformId: 'note-1' }, parentPlatformId: null } })).toBe(12);
    expect(await prisma.metricSnapshot.count({ where: { noteId: officialNote.id } })).toBe(0);
  });

  it('keeps snapshot semantics immutable across source and definition upgrades', async () => {
    const semanticKey = `semantic-views-${crypto.randomUUID()}`;
    const account = await prisma.account.create({ data: { connectorType: 'official', platformId: 'semantic-account' } });
    const note = await prisma.note.create({ data: { accountId: account.id, connectorType: 'official', platformId: 'semantic-note', title: 'Semantic', publishedAt: new Date() } });
    const v1 = await prisma.metricDefinition.create({ data: { key: semanticKey, displayName: '浏览', unit: 'count', source: 'official', version: 'official-v1', aggregation: 'cumulative_delta', effectiveFrom: new Date('2026-01-01'), effectiveTo: new Date('2026-02-01') } });
    const snapshot = await prisma.metricSnapshot.create({ data: { noteId: note.id, metricDefinitionId: v1.id, availability: 'available', value: 10, capturedAt: new Date(), source: 'official', aggregation: 'cumulative_delta', aggregationVersion: 'official-v1' } });
    await prisma.metricDefinition.createMany({ data: [
      { key: semanticKey, displayName: '浏览', unit: 'count', source: 'official', version: 'official-v2', aggregation: 'period_end', effectiveFrom: new Date('2026-02-01') },
      { key: semanticKey, displayName: '浏览', unit: 'count', source: 'mock', version: 'mock-v1', aggregation: 'sum_interval' },
    ] });
    expect(await prisma.metricDefinition.count({ where: { key: semanticKey } })).toBe(3);
    expect(await prisma.metricSnapshot.findUniqueOrThrow({ where: { id: snapshot.id } })).toMatchObject({ aggregation: 'cumulative_delta', aggregationVersion: 'official-v1' });
  });

  it('rejects a wrong-source replay without mutating the historical snapshot', async () => {
    const account = await prisma.account.create({ data: { connectorType: 'official', platformId: 'replay-account' } });
    await prisma.note.create({ data: { accountId: account.id, connectorType: 'official', platformId: 'replay-note', title: 'Replay', publishedAt: new Date() } });
    await repository.startJob('replay-job', account.id);
    const capturedAt = '2026-08-01T12:00:00.000Z';
    await repository.saveMetrics('replay-job', 'official', 'replay-note', [{ noteId: 'replay-note', capturedAt, views: 10, likes: 2, comments: 1, source: 'official' }]);
    const before = await prisma.metricSnapshot.findFirstOrThrow({ where: { note: { platformId: 'replay-note' }, metricDefinition: { key: 'views', source: 'official' } } });
    await expect(repository.saveMetrics('replay-job', 'official', 'replay-note', [{ noteId: 'replay-note', capturedAt, views: 999, likes: 999, comments: 999, source: 'mock' }])).rejects.toThrow('source');
    expect(await prisma.metricSnapshot.findUniqueOrThrow({ where: { id: before.id } })).toMatchObject({ value: before.value, source: 'official', aggregation: before.aggregation, aggregationVersion: before.aggregationVersion });
  });

  it('keeps exact metric replays idempotent and appends changed observations as revisions', async () => {
    const account = await prisma.account.create({ data: { connectorType: 'official', platformId: 'correction-account' } });
    await prisma.note.create({ data: { accountId: account.id, connectorType: 'official', platformId: 'correction-note', title: 'Correction', publishedAt: new Date() } });
    await repository.startJob('correction-job', account.id);
    const base = { noteId: 'correction-note', capturedAt: '2026-08-01T12:00:00.000Z', views: 10, likes: 2, comments: 1, source: 'official' as const };
    await repository.saveMetrics('correction-job', 'official', 'correction-note', [base]);
    await repository.saveMetrics('correction-job', 'official', 'correction-note', [base]);
    expect(await prisma.metricSnapshot.count({ where: { note: { platformId: 'correction-note' }, metricDefinition: { key: 'views' } } })).toBe(1);
    await repository.saveMetrics('correction-job', 'official', 'correction-note', [{ ...base, views: 11 }]);
    const rows = await prisma.metricSnapshot.findMany({ where: { note: { platformId: 'correction-note' }, metricDefinition: { key: 'views' } }, orderBy: { revision: 'asc' } });
    expect(rows.map(({ revision, value, supersededAt }) => [revision, value?.toString(), supersededAt !== null])).toEqual([[1, '10', true], [2, '11', false]]);
    expect(rows[1]?.supersedesId).toBe(rows[0]?.id);
  });

  it('serializes concurrent conflicting metric corrections without losing a revision', async () => {
    const account = await prisma.account.create({ data: { connectorType: 'official', platformId: 'concurrent-correction-account' } });
    await prisma.note.create({ data: { accountId: account.id, connectorType: 'official', platformId: 'concurrent-correction-note', title: 'Correction', publishedAt: new Date() } });
    await repository.startJob('concurrent-correction-job', account.id);
    const base = { noteId: 'concurrent-correction-note', capturedAt: '2026-08-01T12:00:00.000Z', views: 10, likes: 2, comments: 1, source: 'official' as const };
    await repository.saveMetrics('concurrent-correction-job', 'official', 'concurrent-correction-note', [base]);
    await Promise.all([11, 12].map((views) => repository.saveMetrics('concurrent-correction-job', 'official', 'concurrent-correction-note', [{ ...base, views }])));
    const rows = await prisma.metricSnapshot.findMany({ where: { note: { platformId: 'concurrent-correction-note' }, metricDefinition: { key: 'views' } }, orderBy: { revision: 'asc' } });
    expect(rows.map(({ revision }) => revision)).toEqual([1, 2, 3]);
    expect(rows.filter(({ supersededAt }) => supersededAt === null)).toHaveLength(1);
  });

  it('rejects observations and windows outside the selected definition interval', async () => {
    const account = await prisma.account.create({ data: { connectorType: 'official', platformId: 'interval-account' } });
    await prisma.note.create({ data: { accountId: account.id, connectorType: 'official', platformId: 'interval-note', title: 'Interval', publishedAt: new Date() } });
    await prisma.metricDefinition.createMany({ data: ['views', 'likes', 'comments'].map((key) => ({ key, displayName: key, unit: 'count', source: 'official', version: 'official-closed-test', effectiveFrom: new Date('2025-01-01'), effectiveTo: new Date('2025-07-01') })) });
    await repository.startJob('interval-job', account.id);
    const metadata = { aggregation: 'cumulative_delta' as const, aggregationVersion: 'official-closed-test', authoritativePeriod: false };
    await expect(repository.saveMetrics('interval-job', 'official', 'interval-note', [{ noteId: 'interval-note', capturedAt: '2026-08-01T13:00:00Z', views: 1, likes: 1, comments: 1, source: 'official', metricMetadata: { views: metadata, likes: metadata, comments: metadata } }])).rejects.toThrow('effective interval');
    const invalidWindow = { ...metadata, windowStart: '2024-12-31T00:00:00Z', windowEnd: '2025-01-02T00:00:00Z' };
    await expect(repository.saveMetrics('interval-job', 'official', 'interval-note', [{ noteId: 'interval-note', capturedAt: '2025-06-01T13:00:00Z', views: 1, likes: 1, comments: 1, source: 'official', metricMetadata: { views: invalidWindow, likes: invalidWindow, comments: invalidWindow } }])).rejects.toThrow('window is outside');
    const mismatch = { ...metadata, aggregation: 'period_end' as const };
    await expect(repository.saveMetrics('interval-job', 'official', 'interval-note', [{ noteId: 'interval-note', capturedAt: '2025-06-01T13:00:00Z', views: 1, likes: 1, comments: 1, source: 'official', metricMetadata: { views: mismatch, likes: mismatch, comments: mismatch } }])).rejects.toThrow('aggregation does not match');
    const halfWindow = { ...metadata, windowStart: '2025-05-01T00:00:00Z' };
    await expect(repository.saveMetrics('interval-job', 'official', 'interval-note', [{ noteId: 'interval-note', capturedAt: '2025-06-01T13:00:00Z', views: 1, likes: 1, comments: 1, source: 'official', metricMetadata: { views: halfWindow, likes: halfWindow, comments: halfWindow } }])).rejects.toThrow('both start and end');
  });

  it('clears unverifiable verification state after a successful retry', async () => {
    const account = await prisma.account.create({ data: { connectorType: 'mock', platformId: 'account-1' } });
    await repository.startJob('job-recovered', account.id);
    await repository.markUnverifiable('job-recovered', 'temporary repeated cursor');
    await repository.advance('job-recovered', 'complete');

    expect((await new SyncService(new MockXhsConnector(), repository).runAccountSync('job-recovered', account.id)).status).toBe('complete');

    const job = await prisma.syncJob.findUniqueOrThrow({ where: { externalJobId: 'job-recovered' } });
    expect(job.status).toBe('succeeded');
    expect(job.verificationStatus).toBe('verified');
  });
});
