import { Prisma } from '../generated/client/client';
import type { Comment } from '../generated/client/client';

import type { DatabaseClient } from './client';

export interface UpsertCommentInput {
  connectorType: string;
  platformId: string;
  noteId?: string | null;
  parentPlatformId: string | null;
  content: string;
  publishedAt: Date;
  likeCount: number;
  source: string;
}

export class CommentRepository {
  constructor(private readonly prisma: DatabaseClient) {}

  async upsertComment(
    input: UpsertCommentInput,
  ): Promise<{ comment: Comment; created: boolean }> {
    const now = new Date();

    try {
      const comment = await this.prisma.comment.create({
        data: { ...input, firstSeenAt: now, lastSeenAt: now },
      });
      return { comment, created: true };
    } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') {
        throw error;
      }

      const comment = await this.prisma.comment.update({
        where: {
          connectorType_platformId: {
            connectorType: input.connectorType,
            platformId: input.platformId,
          },
        },
        data: {
          noteId: input.noteId,
          parentPlatformId: input.parentPlatformId,
          content: input.content,
          publishedAt: input.publishedAt,
          likeCount: input.likeCount,
          source: input.source,
          lastSeenAt: now,
        },
      });
      return { comment, created: false };
    }
  }
}
