import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { prisma } from './client';
import { importPlatformCollection } from './platform-collection';

function douyinEvents(runId: string) {
  const base = { version: 2 as const, platform: 'douyin' as const, source: 'xiaohuohua' as const, runId };
  const capturedAt = '2026-08-10T01:00:00.000Z';
  return [
    { ...base, type: 'account' as const, account: { platformId: 'creator-1', displayName: '抖音账号', avatarUrl: null } },
    { ...base, type: 'content' as const, content: { platformId: 'content-1', contentKind: 'video' as const, title: '抖音视频', publishedAt: '2026-08-09T01:00:00.000Z' } },
    ...(['views', 'likes', 'comments', 'favorites', 'shares'] as const).map((key, index) => ({ ...base, type: 'metric' as const, metric: { contentId: 'content-1', key, value: index + 1, availability: 'available' as const, capturedAt } })),
    { ...base, type: 'comment' as const, comment: { platformId: 'comment-1', contentId: 'content-1', parentPlatformId: null, authorName: '甲', content: '根评论', publishedAt: '2026-08-10T00:00:00.000Z', likeCount: 2 } },
    { ...base, type: 'comment' as const, comment: { platformId: 'reply-1', contentId: 'content-1', parentPlatformId: 'comment-1', authorName: '乙', content: '回复', publishedAt: '2026-08-10T00:10:00.000Z', likeCount: 0 } },
    { ...base, type: 'completeness' as const, contentId: 'content-1', scope: 'comments' as const, status: 'complete' as const, reason: 'platform_end' as const },
    { ...base, type: 'completeness' as const, contentId: 'content-1', scope: 'replies' as const, status: 'complete' as const, reason: 'platform_end' as const },
    { ...base, type: 'completed' as const, completedAt: capturedAt },
  ];
}

describe('importPlatformCollection', () => {
  beforeEach(async () => {
    await prisma.commentSyncCompleteness.deleteMany({ where: { connectorType: { in: ['xiaohuohua', 'self-scrape'] } } });
    await prisma.comment.deleteMany({ where: { source: { in: ['xiaohuohua', 'self-scrape'] } } });
    await prisma.backfillEvent.deleteMany({ where: { source: { in: ['xiaohuohua', 'self-scrape'] } } });
    await prisma.$executeRawUnsafe(`TRUNCATE TABLE "MetricSnapshot" CASCADE`);
    await prisma.metricDefinition.deleteMany({ where: { source: { in: ['xiaohuohua', 'self-scrape'] } } });
    await prisma.note.deleteMany({ where: { source: { in: ['xiaohuohua', 'self-scrape'] } } });
    await prisma.account.deleteMany({ where: { source: { in: ['xiaohuohua', 'self-scrape'] } } });
  });

  afterAll(async () => prisma.$disconnect());

  it('transactionally and idempotently imports a complete Douyin collection', async () => {
    const events = douyinEvents('douyin-run-1');
    const options = { db: prisma, runId: 'douyin-run-1', platform: 'douyin' as const, accountPlatformId: 'creator-1', source: 'xiaohuohua' as const };
    const first = await importPlatformCollection(events, options);
    const replay = await importPlatformCollection(events, options);

    expect(first).toMatchObject({ platform: 'douyin', source: 'xiaohuohua', contentsChanged: 1, snapshotsChanged: 5, commentsChanged: 2, incompleteContents: 0 });
    expect(replay).toMatchObject({ contentsChanged: 0, snapshotsChanged: 0, commentsChanged: 0, incompleteContents: 0 });
    expect(await prisma.metricDefinition.count({ where: { platform: 'douyin', source: 'xiaohuohua' } })).toBe(5);
    expect(await prisma.comment.count({ where: { platform: 'douyin' } })).toBe(2);
    expect(await prisma.comment.findFirstOrThrow({ where: { platform: 'douyin', platformId: 'comment-1' } })).toMatchObject({ authorName: '甲' });
    expect(await prisma.commentSyncCompleteness.findFirstOrThrow({ where: { connectorType: 'xiaohuohua', notePlatformId: 'content-1' } })).toMatchObject({ status: 'page_complete', error: null });
  });

  it('keeps identical remote IDs separate across platforms', async () => {
    await importPlatformCollection(douyinEvents('douyin-run-1'), { db: prisma, runId: 'douyin-run-1', platform: 'douyin', accountPlatformId: 'creator-1', source: 'xiaohuohua' });
    const xhsEvents = douyinEvents('xhs-run-1').map((event) => ({ ...event, platform: 'xiaohongshu' as const, source: 'self-scrape' as const, runId: 'xhs-run-1' }));
    await importPlatformCollection(xhsEvents, { db: prisma, runId: 'xhs-run-1', platform: 'xiaohongshu', accountPlatformId: 'creator-1', source: 'self-scrape' });

    expect(await prisma.account.count({ where: { platformId: 'creator-1' } })).toBe(2);
    expect(await prisma.note.count({ where: { platformId: 'content-1' } })).toBe(2);
    expect(await prisma.comment.count({ where: { platformId: 'comment-1' } })).toBe(2);
  });
});
