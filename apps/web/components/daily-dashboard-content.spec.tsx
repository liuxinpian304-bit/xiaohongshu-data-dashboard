// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import { DailyDashboardContent } from './daily-dashboard-content';

afterEach(cleanup);

describe('DailyDashboardContent', () => {
  it('composes the latest overview, switchable trend, and daily detail from one row collection', () => {
    render(<DailyDashboardContent rows={[{
      date: '2026-08-04',
      metrics: [{ key: 'likes', aggregation: 'cumulative_delta', value: '21', availability: 'available' }],
      deltas: [{ key: 'likes', value: '9', availability: 'available' }],
    }]} />);

    expect(screen.getByRole('heading', { name: '8月4日概览' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '本月每日趋势' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '每日数据明细' })).toBeInTheDocument();
  });

  it('explains an empty completed-day window without fabricating a row', () => {
    render(<DailyDashboardContent rows={[]} />);

    expect(screen.getByText('本月暂无可展示日报')).toBeInTheDocument();
    expect(screen.queryByRole('table', { name: '每日数据明细' })).not.toBeInTheDocument();
  });
});
