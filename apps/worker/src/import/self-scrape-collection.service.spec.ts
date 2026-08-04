import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { prisma } from '@xhs/database';

import { importSelfScrapeCollection } from './self-scrape-collection.service';

function events(runId: string) {
  const base = { version: 1 as const, source: 'self-scrape' as const, runId };
  return [
    { ...base, type: 'note' as const, note: { platformId: 'col-note-1', title: '采集笔记', publishedAt: '2026-08-03T02:00:00.000Z' } },
    { ...base, type: 'metric' as const, metric: { noteId: 'col-note-1', key: 'views' as const, value: null, availability: 'not_provided' as const, capturedAt: '2026-08-04T07:00:00.000Z' } },
    { ...base, type: 'metric' as const, metric: { noteId: 'col-note-1', key: 'likes' as const, value: 5, availability: 'available' as const, capturedAt: '2026-08-04T07:00:00.000Z' } },
    { ...base, type: 'metric' as const, metric: { noteId: 'col-note-1', key: 'comments' as const, value: 1, availability: 'available' as const, capturedAt: '2026-08-04T07:00:00.000Z' } },
    { ...base, type: 'comment' as const, comment: { platformId: 'col-comment-1', noteId: 'col-note-1', parentPlatformId: null, content: '第一条评论', publishedAt: '2026-08-04T06:00:00.000Z', likeCount: 2 } },
    { ...base, type: 'completeness' as const, noteId: 'col-note-1', scope: 'comments' as const, status: 'page_complete' as const, reason: 'platform_end' as const },
    { ...base, type: 'completed' as const, completedAt: '2026-08-04T07:00:00.000Z' },
  ];
}

describe('importSelfScrapeCollection', () => {
  beforeEach(async () => {
    await prisma.commentSyncCompleteness.deleteMany({ where: { connectorType: 'self-scrape' } });
    await prisma.comment.deleteMany({ where: { connectorType: 'self-scrape' } });
    await prisma.backfillEvent.deleteMany({ where: { source: 'self-scrape' } });
    await prisma.$executeRawUnsafe(`TRUNCATE TABLE "MetricSnapshot" CASCADE`);
    await prisma.metricDefinition.deleteMany({ where: { source: 'self-scrape' } });
    await prisma.note.deleteMany({ where: { connectorType: 'self-scrape' } });
    await prisma.account.deleteMany({ where: { connectorType: 'self-scrape' } });
  });

  afterAll(async () => prisma.$disconnect());

  it('idempotently imports notes metrics comments and completeness', async () => {
    const first = await importSelfScrapeCollection(events('collection-run-1'), { db: prisma, runId: 'collection-run-1', accountPlatformId: 'local-creator' });
    const second = await importSelfScrapeCollection(events('collection-run-2'), { db: prisma, runId: 'collection-run-2', accountPlatformId: 'local-creator' });

    expect(first).toMatchObject({ notesChanged: 1, snapshotsChanged: 3, commentsChanged: 1, incompleteNotes: 0, sha256: expect.stringMatching(/^[a-f0-9]{64}$/) });
    expect(second).toMatchObject({ notesChanged: 0, snapshotsChanged: 0, commentsChanged: 0, incompleteNotes: 0 });
    expect(await prisma.comment.findUniqueOrThrow({ where: { connectorType_platformId: { connectorType: 'self-scrape', platformId: 'col-comment-1' } } })).toMatchObject({ parentPlatformId: null, content: '第一条评论', likeCount: 2, source: 'self-scrape' });
    const account = await prisma.account.findUniqueOrThrow({ where: { connectorType_platformId: { connectorType: 'self-scrape', platformId: 'local-creator' } } });
    expect(await prisma.commentSyncCompleteness.findUniqueOrThrow({ where: { connectorType_accountId_notePlatformId: { connectorType: 'self-scrape', accountId: account.id, notePlatformId: 'col-note-1' } } })).toMatchObject({ status: 'page_complete', error: null });
  });

  it('rejects a partial event set without committing rows', async () => {
    await expect(importSelfScrapeCollection(events('partial-run').filter((event) => event.type !== 'completed'), { db: prisma, runId: 'partial-run', accountPlatformId: 'local-creator' })).rejects.toThrow('collection_not_completed');
    expect(await prisma.account.count({ where: { connectorType: 'self-scrape' } })).toBe(0);
  });
});
