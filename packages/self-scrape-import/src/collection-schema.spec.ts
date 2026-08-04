import { describe, expect, it } from 'vitest';

import { normalizeCollectionEvent } from './collection-schema';

const runId = '00000000-0000-4000-8000-000000000001';
const commentEvent = {
  version: 1,
  type: 'comment',
  source: 'self-scrape',
  runId,
  comment: {
    platformId: 'comment-1',
    noteId: 'note-1',
    parentPlatformId: null,
    content: '真实评论内容',
    publishedAt: '2026-08-03T10:00:00+08:00',
    likeCount: 2,
  },
};

describe('normalizeCollectionEvent', () => {
  it('normalizes a versioned self-scrape comment without losing reply identity', () => {
    expect(normalizeCollectionEvent(commentEvent)).toEqual({
      ...commentEvent,
      comment: { ...commentEvent.comment, publishedAt: '2026-08-03T02:00:00.000Z' },
    });
  });

  it.each([
    ['unknown root field', { ...commentEvent, cookie: 'secret' }, 'unknown_field'],
    ['wrong source', { ...commentEvent, source: 'official' }, 'invalid_source'],
    ['negative likes', { ...commentEvent, comment: { ...commentEvent.comment, likeCount: -1 } }, 'invalid_count'],
    ['timestamp without timezone', { ...commentEvent, comment: { ...commentEvent.comment, publishedAt: '2026-08-03T10:00:00' } }, 'invalid_timestamp'],
    ['unknown comment field', { ...commentEvent, comment: { ...commentEvent.comment, authorCookie: 'secret' } }, 'unknown_field'],
  ])('rejects %s with a redacted error', (_name, input, code) => {
    expect(() => normalizeCollectionEvent(input)).toThrowError(expect.objectContaining({ code }));
    expect(() => normalizeCollectionEvent(input)).toThrowError(expect.not.stringContaining('authorCookie'));
  });

  it('normalizes terminal completeness only for an explicit platform end', () => {
    expect(normalizeCollectionEvent({
      version: 1,
      type: 'completeness',
      source: 'self-scrape',
      runId,
      noteId: 'note-1',
      scope: 'comments',
      status: 'page_complete',
      reason: 'platform_end',
    })).toMatchObject({ type: 'completeness', status: 'page_complete', reason: 'platform_end' });
  });

  it('rejects a complete marker that was not proven by a platform end', () => {
    expect(() => normalizeCollectionEvent({
      version: 1,
      type: 'completeness',
      source: 'self-scrape',
      runId,
      noteId: 'note-1',
      scope: 'comments',
      status: 'page_complete',
      reason: 'timeout',
    })).toThrowError(expect.objectContaining({ code: 'invalid_completeness' }));
  });
});
