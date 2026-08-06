// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import { DailyTrendExplorer } from './daily-trend-explorer';

afterEach(cleanup);

const rows = [
  { date: '2026-08-03', metrics: [{ key: 'likes', aggregation: 'cumulative_delta' as const, value: '12', availability: 'available' as const }, { key: 'comments', aggregation: 'cumulative_delta' as const, value: '3', availability: 'available' as const }], deltas: [] },
  { date: '2026-08-04', metrics: [{ key: 'likes', aggregation: 'cumulative_delta' as const, value: '21', availability: 'available' as const }, { key: 'comments', aggregation: 'cumulative_delta' as const, value: '8', availability: 'available' as const }], deltas: [] },
];

describe('DailyTrendExplorer', () => {
  it('switches the visible and accessible series without changing the daily rows', () => {
    render(<DailyTrendExplorer rows={rows} />);

    expect(screen.getByRole('img', { name: '点赞每日趋势图' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '评论' }));
    expect(screen.getByRole('img', { name: '评论每日趋势图' })).toBeInTheDocument();
    expect(screen.getByRole('table', { name: '评论每日趋势数据' })).toHaveTextContent('8');
    expect(screen.getByRole('button', { name: '评论' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('does not draw an unavailable point as zero', () => {
    render(<DailyTrendExplorer rows={[{ date: '2026-08-04', metrics: [{ key: 'likes', aggregation: 'cumulative_delta', value: null, availability: 'not_provided' }], deltas: [] }]} />);

    expect(screen.getByText('点赞暂无可用数据')).toBeInTheDocument();
    expect(screen.queryByText('0')).not.toBeInTheDocument();
  });
});
