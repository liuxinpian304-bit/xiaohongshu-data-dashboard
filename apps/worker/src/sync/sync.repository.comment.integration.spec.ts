import { afterAll, describe, expect, it } from 'vitest';
import { createDatabaseClient } from '@xhs/database';
import { SyncRepository } from './sync.repository';

const url = process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:55432/xhs_dashboard';
const firstDb = createDatabaseClient(url); const secondDb = createDatabaseClient(url);

describe('SyncRepository concurrent comment inserts', () => {
  afterAll(async () => Promise.all([firstDb.$disconnect(), secondDb.$disconnect()]));
  it('reports a comment as created in exactly one concurrent transaction', async () => {
    const account = await firstDb.account.create({ data: { connectorType: 'comment-race', platformId: crypto.randomUUID() } });
    const notePlatformId = `race-note-${account.id}`;
    await firstDb.note.create({ data: { accountId: account.id, connectorType: 'comment-race', platformId: notePlatformId, title: 'Race', publishedAt: new Date() } });
    await Promise.all([new SyncRepository(firstDb).startJob(`race-a-${account.id}`, account.id), new SyncRepository(secondDb).startJob(`race-b-${account.id}`, account.id)]);
    const comment = { platformId: `race-comment-${account.id}`, noteId: notePlatformId, authorName: 'A', content: 'C', createdAt: new Date().toISOString(), source: 'mock' as const };
    const results = await Promise.all([
      new SyncRepository(firstDb).saveCommentsPage(`race-a-${account.id}`, account.id, 'comment-race', notePlatformId, [comment], null),
      new SyncRepository(secondDb).saveCommentsPage(`race-b-${account.id}`, account.id, 'comment-race', notePlatformId, [comment], null),
    ]);
    expect(results.map((created) => created.length).sort()).toEqual([0, 1]);
    expect(await firstDb.comment.count({ where: { platformId: comment.platformId } })).toBe(1);
    await firstDb.comment.deleteMany({ where: { note: { accountId: account.id } } });
    await firstDb.note.deleteMany({ where: { accountId: account.id } });
    await firstDb.account.deleteMany({ where: { id: account.id } });
  });
});
