import { prisma } from '@xhs/database';
import { beforeEach, describe, expect, it } from 'vitest';
import { CommentsService } from './comments.service';

describe('safe comment CSV export', () => {
  beforeEach(async () => { await prisma.syncJob.deleteMany({ where: { account: { connectorType: 'export-test' } } }); await prisma.comment.deleteMany({ where: { connectorType: 'export-test' } }); await prisma.note.deleteMany({ where: { connectorType: 'export-test' } }); await prisma.account.deleteMany({ where: { connectorType: 'export-test' } }); });
  async function seed(contents: string[]) {
    const account = await prisma.account.create({ data: { connectorType: 'export-test', platformId: crypto.randomUUID() } });
    const note = await prisma.note.create({ data: { accountId: account.id, connectorType: 'export-test', platformId: crypto.randomUUID(), title: 'note', publishedAt: new Date() } });
    await prisma.comment.createMany({ data: contents.map((content) => ({ noteId: note.id, connectorType: 'export-test', platformId: crypto.randomUUID(), content, publishedAt: new Date(), source: 'official' })) });
    return account;
  }
  it('streams rows in chunks and neutralizes spreadsheet formulas', async () => {
    const account = await seed(['=HYPERLINK("https://evil")', 'safe']);
    const result = await new CommentsService({ maxRows: 100, maxBytes: 1_000_000, chunkSize: 1 }).export({ accountId: account.id });
    expect(result.background).toBe(false);
    let csv = ''; for await (const chunk of result.stream!) csv += chunk;
    expect(csv).toContain('"\'=HYPERLINK(""https://evil"")"');
  });
  it('creates a scoped background export before loading oversized result rows', async () => {
    const account = await seed(['one', 'two', 'three']);
    const result = await new CommentsService({ maxRows: 2, maxBytes: 1_000_000, chunkSize: 1 }).export({ accountId: account.id });
    expect(result.background).toBe(true);
    const job = await prisma.syncJob.findUniqueOrThrow({ where: { id: result.jobId } });
    expect(job.payload).toMatchObject({ accountIds: [account.id], filter: { accountId: account.id } });
  });
  it('streams immutable snapshot values after matching rows are modified and deleted', async () => {
    const account = await seed(['before-update', 'before-delete']);
    const result = await new CommentsService({ maxRows: 100, maxBytes: 1_000_000, chunkSize: 1 }).export({ accountId: account.id });
    await prisma.comment.updateMany({ where: { content: 'before-update' }, data: { content: 'after-update' } });
    await prisma.comment.deleteMany({ where: { content: 'before-delete' } });
    let csv = ''; for await (const chunk of result.stream!) csv += chunk;
    expect(csv).toContain('before-update'); expect(csv).toContain('before-delete'); expect(csv).not.toContain('after-update');
  });
  it('routes quote-amplified CSV over the exact byte threshold to a background job', async () => {
    const account = await seed(['"'.repeat(200)]);
    const result = await new CommentsService({ maxRows: 100, maxBytes: 450, chunkSize: 10 }).export({ accountId: account.id });
    expect(result.background).toBe(true);
  });
  it('creates one uniquely scoped background job per account', async () => {
    const first = await seed(['first']); const second = await seed(['second']);
    const result = await new CommentsService({ maxRows: 1, maxBytes: 1_000_000, chunkSize: 10 }).export({ accountIds: [first.id, second.id] });
    expect(result.background).toBe(true);
    const jobs = await prisma.syncJob.findMany({ where: { id: { in: result.jobIds } }, orderBy: { accountId: 'asc' } });
    expect(jobs).toHaveLength(2);
    for (const job of jobs) expect(job.payload).toMatchObject({ filter: { accountId: job.accountId }, requestedScope: { accountIds: expect.arrayContaining([first.id, second.id]) } });
  });
});
