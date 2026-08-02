import { BadRequestException } from '@nestjs/common';

export type PageInfo = { nextCursor: string | null; hasMore: boolean };
export function pagination(query: { cursor?: string; limit?: string | number }) {
  const limit = query.limit === undefined ? 50 : Number(query.limit);
  if (!Number.isInteger(limit) || limit < 1 || limit > 200) throw new BadRequestException('limit must be between 1 and 200');
  if (query.cursor && query.cursor.length > 200) throw new BadRequestException('invalid cursor');
  return { cursor: query.cursor, limit };
}
export function page<T extends { id: string }>(items: T[], limit: number) {
  const hasMore = items.length > limit;
  const sliced = hasMore ? items.slice(0, limit) : items;
  return { items: sliced, pageInfo: { nextCursor: hasMore ? sliced.at(-1)?.id ?? null : null, hasMore } };
}
