import { describe, expect, it } from 'vitest';

import { parseCreatorPayload } from './creator-payload';

describe('parseCreatorPayload', () => {
  it('extracts owned notes and visible cumulative metrics from a creator response', () => {
    expect(parseCreatorPayload({
      data: {
        notes: [{ note_id: 'note-1', title: '第一条笔记', publish_time: 1_754_214_400, like_count: 12, comment_count: 3 }],
        cursor: 'next-1',
        has_more: true,
      },
    }, '2026-08-04T07:00:00.000Z')).toEqual({
      notes: [{ platformId: 'note-1', title: '第一条笔记', publishedAt: '2025-08-03T09:46:40.000Z', metrics: { views: null, likes: 12, comments: 3 }, capturedAt: '2026-08-04T07:00:00.000Z' }],
      comments: [],
      page: { cursor: 'next-1', hasMore: true },
    });
  });

  it('maps the current creator note-manager field names observed in the browser', () => {
    expect(parseCreatorPayload({
      code: 0,
      success: true,
      data: {
        notes: [{ id: 'note-real-1', display_title: '创作中心标题', time: '1754214400', likes: 9, comments_count: 4, view_count: 88 }],
        page: 1,
      },
    }, '2026-08-04T07:00:00.000Z').notes).toEqual([
      { platformId: 'note-real-1', title: '创作中心标题', publishedAt: '2025-08-03T09:46:40.000Z', metrics: { views: 88, likes: 9, comments: 4 }, capturedAt: '2026-08-04T07:00:00.000Z' },
    ]);
  });

  it('extracts comments and replies while preserving parent identity', () => {
    expect(parseCreatorPayload({
      data: {
        comments: [{
          comment_id: 'comment-1', note_id: 'note-1', content: '一级评论', create_time: 1_754_214_400, like_count: 2,
          sub_comments: [{ comment_id: 'reply-1', note_id: 'note-1', target_comment_id: 'comment-1', content: '回复内容', create_time: 1_754_214_500, like_count: 1 }],
        }],
        cursor: '',
        has_more: false,
      },
    }, '2026-08-04T07:00:00.000Z')).toMatchObject({
      comments: [
        { platformId: 'comment-1', noteId: 'note-1', parentPlatformId: null, content: '一级评论', likeCount: 2 },
        { platformId: 'reply-1', noteId: 'note-1', parentPlatformId: 'comment-1', content: '回复内容', likeCount: 1 },
      ],
      page: { cursor: null, hasMore: false },
    });
  });

  it('does not mistake unrelated ids or display strings for collectable records', () => {
    expect(parseCreatorPayload({ data: { id: 'user-1', title: '页面标题', like_count: '1.2万', has_more: false } }, '2026-08-04T07:00:00.000Z')).toEqual({ notes: [], comments: [], page: { cursor: null, hasMore: false } });
  });

  it('rejects oversized or deeply nested response structures', () => {
    expect(() => parseCreatorPayload('x'.repeat(5_000_001), '2026-08-04T07:00:00.000Z')).toThrowError('collector_payload_too_large');
    let nested: unknown = {};
    for (let index = 0; index < 40; index += 1) nested = { data: nested };
    expect(() => parseCreatorPayload(nested, '2026-08-04T07:00:00.000Z')).toThrowError('collector_payload_too_deep');
  });
});
