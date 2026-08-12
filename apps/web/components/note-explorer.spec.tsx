// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Note } from '../lib/api';
import { NoteExplorer } from './note-explorer';

const notes: Note[] = [{
  id: 'note-1', accountId: 'account-1', platform: 'xiaohongshu', connectorType: 'self-scrape', platformId: 'platform-note-1',
  title: '一眼看懂的数据笔记', publishedAt: '2026-08-06T09:00:00.000Z', lastSeenAt: '2026-08-06T10:00:00.000Z',
  account: { id: 'account-1', platform: 'xiaohongshu', displayName: '测试账号', platformId: 'xhs-1' },
  metrics: [
    { key: 'views', displayName: '阅读', value: '1280', availability: 'available', source: 'self-scrape', observedAt: '2026-08-06T10:00:00.000Z' },
    { key: 'likes', displayName: '点赞', value: '86', availability: 'available', source: 'self-scrape', observedAt: '2026-08-06T10:00:00.000Z' },
    { key: 'comments', displayName: '评论', value: null, availability: 'not_synced', source: 'self-scrape', observedAt: '2026-08-06T10:00:00.000Z' },
  ],
  commentCompleteness: null,
}];

describe('NoteExplorer', () => {
  beforeEach(() => localStorage.clear());
  afterEach(cleanup);

  it('shows core metrics in the default table view without opening a note', () => {
    render(<NoteExplorer notes={notes} />);
    expect(screen.getByRole('table')).toBeInTheDocument();
    expect(screen.getByText('1,280')).toBeInTheDocument();
    expect(screen.getByText('86')).toBeInTheDocument();
    expect(screen.getAllByText('尚未同步')).toHaveLength(2);
    expect(screen.getByRole('link', { name: '一眼看懂的数据笔记' })).toHaveAttribute('href', '/notes/note-1');
    expect(document.body.textContent).not.toContain('演示连接器');
    expect(document.body.textContent).not.toContain('演示数据');
  });

  it('switches to cards and remembers the preference', () => {
    const view = render(<NoteExplorer notes={notes} />);
    fireEvent.click(screen.getByRole('button', { name: '卡片视图' }));
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(screen.getByTestId('note-card-grid')).toBeInTheDocument();
    expect(localStorage.getItem('xhs-note-view')).toBe('cards');
    view.unmount();
    render(<NoteExplorer notes={notes} />);
    expect(screen.getByTestId('note-card-grid')).toBeInTheDocument();
  });
});
