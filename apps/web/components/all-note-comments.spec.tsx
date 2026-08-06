// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AllNoteComments } from './all-note-comments';

const first = { id: 'c1', noteId: '00000000-0000-4000-8000-000000000001', connectorType: 'self-scrape', platformId: 'p1', parentPlatformId: null, content: '第一页评论', publishedAt: '2026-08-06T01:00:00.000Z', likeCount: 2, source: 'self-scrape' };
const second = { ...first, id: 'c2', platformId: 'p2', content: '第二页评论' };

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('AllNoteComments', () => {
  it('automatically follows every cursor and renders all comments', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ items: [second], pageInfo: { hasMore: false, nextCursor: null } }), { status: 200, headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', fetcher);
    render(<AllNoteComments noteId="00000000-0000-4000-8000-000000000001" initial={{ items: [first], pageInfo: { hasMore: true, nextCursor: 'c1' } }} />);
    expect(screen.getByText('第一页评论')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText('第二页评论')).toBeInTheDocument());
    expect(fetcher).toHaveBeenCalledWith('/api/comments?noteId=00000000-0000-4000-8000-000000000001&limit=200&cursor=c1', expect.any(Object));
    expect(screen.getByText('已加载全部 2 条评论与回复')).toBeInTheDocument();
  });

  it('stops safely when the server repeats a cursor', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ items: [second], pageInfo: { hasMore: true, nextCursor: 'c1' } }), { status: 200 })));
    render(<AllNoteComments noteId="00000000-0000-4000-8000-000000000001" initial={{ items: [first], pageInfo: { hasMore: true, nextCursor: 'c1' } }} />);
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('分页异常'));
  });
});
