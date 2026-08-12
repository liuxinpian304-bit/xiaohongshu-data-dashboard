// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import { describe, expect, it } from 'vitest';

import { CommentTree } from './comment-tree';

const comments = [
  { id: 'comment-1', platformId: 'platform-1', parentPlatformId: null, authorName: '甲', content: '顶层评论', publishedAt: '2026-08-01T00:00:00.000Z', likeCount: 2 },
  { id: 'comment-2', platformId: 'platform-2', parentPlatformId: 'platform-1', authorName: '乙', content: '回复内容', publishedAt: '2026-08-01T01:00:00.000Z', likeCount: 1 },
];

describe('CommentTree', () => {
  it('renders replies under their parent and labels page completion precisely', () => {
    render(<CommentTree comments={comments} completeness="page_complete" />);
    expect(screen.getByText('本轮官方分页已完成')).toBeInTheDocument();
    expect(screen.getByText('回复内容')).toHaveAttribute('data-parent-id', 'comment-1');
    expect(screen.getByText('甲')).toBeInTheDocument();
    expect(screen.getByText('乙')).toBeInTheDocument();
  });

  it('does not claim full history when only the loaded page is complete', () => {
    render(<CommentTree comments={comments} completeness="page_complete" />);
    expect(screen.queryByText('历史评论已全部抓取')).not.toBeInTheDocument();
  });
});
