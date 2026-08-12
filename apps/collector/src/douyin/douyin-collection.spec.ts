import { describe, expect, it } from 'vitest';

import { collectDouyinEvents, DouyinCursorTracker, collectionWindow } from './douyin-collection';

describe('collectDouyinEvents', () => {
  it('maps creator works, metrics and comments without inventing missing views', () => {
    const events = collectDouyinEvents(
      { platformId: 'douyin:7390000000000000000', douyinAccountId: 'YPSJ0725', displayName: 'P', avatarUrl: null },
      [{ aweme_list: [{ aweme_id: 'work-1', desc: '作品一', create_time: 1786406400, statistics: { digg_count: 12, comment_count: 2, share_count: 3 } }] },
       { comments: [{ cid: 'comment-1', aweme_id: 'work-1', text: '真好看', create_time: 1786406500, digg_count: 4, user: { nickname: '观众甲' } }], has_more: false, cursor: 1 }],
      'run-1',
      '2026-08-11T08:00:00.000Z',
    );

    expect(events).toContainEqual(expect.objectContaining({ type: 'content', content: expect.objectContaining({ platformId: 'work-1', title: '作品一' }) }));
    expect(events).toContainEqual(expect.objectContaining({ type: 'metric', metric: { contentId: 'work-1', key: 'likes', value: 12, availability: 'available', capturedAt: '2026-08-11T08:00:00.000Z' } }));
    expect(events).toContainEqual(expect.objectContaining({ type: 'metric', metric: { contentId: 'work-1', key: 'views', value: null, availability: 'not_provided', capturedAt: '2026-08-11T08:00:00.000Z' } }));
    expect(events).toContainEqual(expect.objectContaining({ type: 'comment', comment: expect.objectContaining({ platformId: 'comment-1', contentId: 'work-1', content: '真好看' }) }));
    expect(events).toContainEqual(expect.objectContaining({ type: 'completeness', contentId: 'work-1', scope: 'comments', status: 'complete', reason: 'platform_end' }));
    expect(events.at(-1)).toEqual({ version: 2, platform: 'douyin', source: 'self-scrape', runId: 'run-1', type: 'completed', completedAt: '2026-08-11T08:00:00.000Z' });
  });

  it('does not claim complete comments when the payload has no explicit platform end', () => {
    const events = collectDouyinEvents(
      { platformId: 'douyin:1', douyinAccountId: 'one', displayName: 'One', avatarUrl: null },
      [{ aweme_list: [{ aweme_id: 'work-1', desc: '作品' }] }, { comments: [{ cid: 'c1', aweme_id: 'work-1', text: '评论' }] }],
      'run-partial', '2026-08-11T08:00:00.000Z',
    );
    expect(events).toContainEqual(expect.objectContaining({ type: 'completeness', contentId: 'work-1', scope: 'comments', status: 'partial', reason: 'page_changed' }));
  });

  it('detects repeated cursors and enforces the page bound', () => {
    const tracker = new DouyinCursorTracker(2);
    expect(tracker.accept('first')).toBe(true);
    expect(() => tracker.accept('first')).toThrow('douyin_repeated_cursor');
    expect(tracker.accept('second')).toBe(true);
    expect(() => tracker.accept('third')).toThrow('douyin_page_limit');
  });

  it('accepts creator-center item aliases and keeps zero as an authoritative value', () => {
    const events = collectDouyinEvents(
      { platformId: 'douyin:1', douyinAccountId: 'one', displayName: 'One', avatarUrl: null },
      [{ item_list: [{ item_id: 'item-1', title: '标题', publish_time: '2026-08-10T00:00:00.000Z', play_count: 0, like_count: 0, comment_count: 0 }] }],
      'run-2', '2026-08-11T08:00:00.000Z',
    );
    expect(events).toContainEqual(expect.objectContaining({ type: 'metric', metric: expect.objectContaining({ key: 'views', value: 0, availability: 'zero' }) }));
  });

  it('uses the Shanghai current month normally and only permits previous month finalization on day one', () => {
    expect(collectionWindow(new Date('2026-08-12T02:00:00.000Z'), 'daily')).toEqual({ from: '2026-08-01T00:00:00+08:00', to: '2026-08-12T23:59:59.999+08:00' });
    expect(collectionWindow(new Date('2026-08-01T02:00:00.000Z'), 'previous_month_final')).toEqual({ from: '2026-07-01T00:00:00+08:00', to: '2026-07-31T23:59:59.999+08:00' });
    expect(() => collectionWindow(new Date('2026-08-12T02:00:00.000Z'), 'previous_month_final')).toThrow('douyin_previous_month_not_allowed');
  });

  it('excludes scheduled, unpublished and previous-month works from a daily run', () => {
    const events = collectDouyinEvents(
      { platformId: 'douyin:1', douyinAccountId: 'one', displayName: 'One', avatarUrl: null },
      [{ aweme_list: [
        { aweme_id: 'august', desc: '本月', create_time: 1785513600, status: 'published' },
        { aweme_id: 'july', desc: '上月', create_time: 1782835200, status: 'published' },
        { aweme_id: 'scheduled', desc: '定时', create_time: 1785513600, status: 'scheduled' },
      ] }], 'run-window', '2026-08-12T02:00:00.000Z', { mode: 'daily' },
    );
    const ids = events.filter((event) => event.type === 'content').map((event) => event.content.platformId);
    expect(ids).toEqual(['august']);
  });
});
