// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import React from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import { DailyMetricsTable } from './daily-metrics-table';

afterEach(cleanup);

describe('DailyMetricsTable', () => {
  it('shows each completed day newest first with required columns and comparison summary', () => {
    render(<DailyMetricsTable rows={[
      { date: '2026-08-03', metrics: [{ key: 'notes', aggregation: 'sum_interval', value: '1', availability: 'available' }, { key: 'likes', aggregation: 'cumulative_delta', value: '12', availability: 'available' }], deltas: [{ key: 'likes', value: null, availability: 'not_synced' }] },
      { date: '2026-08-04', metrics: [{ key: 'notes', aggregation: 'sum_interval', value: '2', availability: 'available' }, { key: 'likes', aggregation: 'cumulative_delta', value: '21', availability: 'available' }], deltas: [{ key: 'likes', value: '9', availability: 'available' }] },
    ]} />);

    const table = screen.getByRole('table', { name: '每日数据明细' });
    for (const label of ['日期', '笔记', '访客', '点赞', '评论', '收藏', '较前一天']) expect(within(table).getByRole('columnheader', { name: label })).toBeInTheDocument();
    const rows = within(table).getAllByRole('row');
    expect(rows[1]).toHaveTextContent('8月4日');
    expect(rows[2]).toHaveTextContent('8月3日');
    expect(rows[1]).toHaveTextContent('点赞 +9');
  });

  it('labels unavailable values instead of turning them into zero', () => {
    render(<DailyMetricsTable rows={[{ date: '2026-08-04', metrics: [{ key: 'views', aggregation: 'cumulative_delta', value: null, availability: 'not_provided' }], deltas: [] }]} />);

    expect(screen.getByText('暂无数据')).toBeInTheDocument();
    expect(screen.queryByText('0')).not.toBeInTheDocument();
  });
});
