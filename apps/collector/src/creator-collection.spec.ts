import { describe, expect, it, vi } from 'vitest';

import { collectCreatorEvents } from './creator-collection';

describe('collectCreatorEvents', () => {
  it('emits normalized note metrics comments and an honest incomplete marker', async () => {
    const emit = vi.fn();
    const progress = vi.fn();
    await collectCreatorEvents({
      collectVisibleRecords: async () => ({
        notes: [{ platformId: 'note-1', title: '本人笔记', publishedAt: '2026-08-03T02:00:00.000Z', capturedAt: '2026-08-04T07:00:00.000Z', metrics: { views: null, likes: 5, comments: 1 } }],
        comments: [{ platformId: 'comment-1', noteId: 'note-1', parentPlatformId: null, content: '评论', publishedAt: '2026-08-03T03:00:00.000Z', likeCount: 2 }],
      }),
    }, progress, emit, 'run-1', '2026-08-04T07:00:00.000Z');

    expect(emit.mock.calls.map(([event]) => event)).toEqual([
      { version: 1, type: 'note', source: 'self-scrape', runId: 'run-1', note: { platformId: 'note-1', title: '本人笔记', publishedAt: '2026-08-03T02:00:00.000Z' } },
      { version: 1, type: 'metric', source: 'self-scrape', runId: 'run-1', metric: { noteId: 'note-1', key: 'views', value: null, availability: 'not_provided', capturedAt: '2026-08-04T07:00:00.000Z' } },
      { version: 1, type: 'metric', source: 'self-scrape', runId: 'run-1', metric: { noteId: 'note-1', key: 'likes', value: 5, availability: 'available', capturedAt: '2026-08-04T07:00:00.000Z' } },
      { version: 1, type: 'metric', source: 'self-scrape', runId: 'run-1', metric: { noteId: 'note-1', key: 'comments', value: 1, availability: 'available', capturedAt: '2026-08-04T07:00:00.000Z' } },
      { version: 1, type: 'comment', source: 'self-scrape', runId: 'run-1', comment: { platformId: 'comment-1', noteId: 'note-1', parentPlatformId: null, content: '评论', publishedAt: '2026-08-03T03:00:00.000Z', likeCount: 2 } },
      { version: 1, type: 'completeness', source: 'self-scrape', runId: 'run-1', noteId: 'note-1', scope: 'comments', status: 'unverifiable', reason: 'page_changed' },
      { version: 1, type: 'completed', source: 'self-scrape', runId: 'run-1', completedAt: '2026-08-04T07:00:00.000Z' },
    ]);
    expect(progress).toHaveBeenLastCalledWith({ stage: 'reports', processed: 1, total: 1, incompleteNotes: 1 });
  });

  it('marks a platform-declared zero-comment note complete', async () => {
    const events: any[] = [];
    const progress = vi.fn();
    await collectCreatorEvents({ collectVisibleRecords: async () => ({
      notes: [{ platformId: 'note-empty', title: '', publishedAt: '2026-08-03T02:00:00.000Z', capturedAt: '2026-08-04T07:00:00.000Z', metrics: { views: 4, likes: 0, comments: 0 } }],
      comments: [],
    }) }, progress, (event) => events.push(event), 'run-empty', '2026-08-04T07:00:00.000Z');

    expect(events).toContainEqual(expect.objectContaining({ type: 'completeness', noteId: 'note-empty', status: 'page_complete', reason: 'platform_end' }));
    expect(progress).toHaveBeenLastCalledWith(expect.objectContaining({ incompleteNotes: 0 }));
  });
});
