'use client';

import React, { useEffect, useState } from 'react';
import type { Comment, CursorPage } from '../lib/api';
import { CommentTree } from './comment-tree';

const MAX_PAGES = 1_000;
const MAX_ROWS = 100_000;
const RENDER_STEP = 500;

export function AllNoteComments({ noteId, initial }: { noteId: string; initial: CursorPage<Comment> }) {
  const [comments, setComments] = useState(initial.items);
  const [loading, setLoading] = useState(initial.pageInfo.hasMore);
  const [error, setError] = useState('');
  const [visible, setVisible] = useState(RENDER_STEP);

  useEffect(() => {
    if (!initial.pageInfo.hasMore || !initial.pageInfo.nextCursor) { setLoading(false); return; }
    const controller = new AbortController();
    async function loadAll() {
      let cursor: string | null = initial.pageInfo.nextCursor; let pages = 0; const seen = new Set<string>(); const collected = [...initial.items]; const ids = new Set(collected.map(({ id }) => id));
      while (cursor) {
        if (pages++ >= MAX_PAGES || collected.length >= MAX_ROWS || seen.has(cursor)) throw new Error('评论分页异常，已停止自动加载。');
        seen.add(cursor);
        const query = new URLSearchParams({ noteId, limit: '200', cursor });
        const response = await fetch(`/api/comments?${query}`, { cache: 'no-store', signal: controller.signal });
        if (!response.ok) throw new Error('评论加载失败，请刷新后重试。');
        const page = await response.json() as CursorPage<Comment>;
        for (const item of page.items) if (!ids.has(item.id)) { ids.add(item.id); collected.push(item); }
        setComments([...collected]);
        const next = page.pageInfo.hasMore ? page.pageInfo.nextCursor : null;
        if (page.pageInfo.hasMore && !next) throw new Error('评论分页异常，缺少下一页位置。');
        cursor = next;
      }
      setLoading(false);
    }
    loadAll().catch((reason) => { if (!controller.signal.aborted) { setError(reason instanceof Error ? reason.message : '评论加载失败。'); setLoading(false); } });
    return () => controller.abort();
  }, [initial, noteId]);

  return <div className="all-note-comments">
    <div className="comment-load-status" aria-live="polite"><strong>{loading ? `正在自动加载，已读取 ${comments.length} 条…` : `已加载全部 ${comments.length} 条评论与回复`}</strong><span>评论和回复都会计入数量。</span></div>
    {error ? <p className="compact-error" role="alert">{error}</p> : null}
    <CommentTree comments={comments.slice(0, visible)} completeness={loading || error ? 'unknown' : 'page_complete'} />
    {comments.length > visible ? <button className="secondary-button comment-show-more" type="button" onClick={() => setVisible((count) => count + RENDER_STEP)}>继续显示（剩余 {comments.length - visible} 条）</button> : null}
  </div>;
}
