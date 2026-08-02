import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { prisma } from './client';
import { CommentRepository } from './comment.repository';

describe('CommentRepository', () => {
  const repository = new CommentRepository(prisma);

  beforeEach(async () => {
    await prisma.comment.deleteMany();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('upserts the same platform comment without duplication', async () => {
    const commentInput = {
      connectorType: 'xiaohongshu',
      platformId: 'comment-1001',
      parentPlatformId: null,
      content: 'first version',
      publishedAt: new Date('2026-08-01T10:00:00.000Z'),
      likeCount: 3,
      source: 'official_api',
    };

    const first = await repository.upsertComment(commentInput);
    const second = await repository.upsertComment({
      ...commentInput,
      likeCount: 9,
    });

    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(await prisma.comment.count()).toBe(1);
    expect(second.comment.likeCount).toBe(9);
  });
});
