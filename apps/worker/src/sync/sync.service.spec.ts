import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import type { XhsConnector } from '@xhs/connector';
import { MockXhsConnector } from '@xhs/connector';
import { prisma } from '@xhs/database';

import { SyncRepository } from './sync.repository';
import { SyncService } from './sync.service';

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
    await prisma.syncCheckpoint.deleteMany();
    await prisma.syncStep.deleteMany();
    await prisma.syncJob.deleteMany();
    await prisma.comment.deleteMany();
    await prisma.metricSnapshot.deleteMany();
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

    connector.stopFailing();
    await service.runAccountSync('job-1', account.id);

    expect(await repository.countComments('note-1')).toBe(12);
    expect(await repository.getCommentCursor('job-1', 'note-1')).toBeNull();
  });

  it('keeps comments idempotent when a completed job is run again', async () => {
    const account = await prisma.account.create({ data: { connectorType: 'mock', platformId: 'account-1' } });
    const service = new SyncService(new MockXhsConnector(), repository);

    await service.runAccountSync('job-idempotent', account.id);
    await service.runAccountSync('job-idempotent', account.id);

    expect(await repository.countComments('note-1')).toBe(12);
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
    expect(await repository.countComments('note-1')).toBe(5);
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
});
