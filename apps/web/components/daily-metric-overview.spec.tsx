// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import { DailyMetricOverview } from './daily-metric-overview';

afterEach(cleanup);

describe('DailyMetricOverview', () => {
  it('shows the latest completed day with values, signed comparisons, and explicit missing data', () => {
    render(<DailyMetricOverview row={{
      date: '2026-08-04',
      metrics: [
        { key: 'notes', aggregation: 'sum_interval', value: '2', availability: 'available' },
        { key: 'views', aggregation: 'cumulative_delta', value: null, availability: 'not_provided' },
        { key: 'likes', aggregation: 'cumulative_delta', value: '1280', availability: 'available' },
        { key: 'comments', aggregation: 'cumulative_delta', value: '42', availability: 'available' },
        { key: 'favorites', aggregation: 'cumulative_delta', value: '86', availability: 'available' },
      ],
      deltas: [
        { key: 'notes', value: '1', availability: 'available' },
        { key: 'views', value: null, availability: 'not_provided' },
        { key: 'likes', value: '12', availability: 'available' },
        { key: 'comments', value: '-3', availability: 'available' },
        { key: 'favorites', value: '0', availability: 'zero' },
      ],
    }} />);

    expect(screen.getByRole('heading', { name: '8月4日概览' })).toBeInTheDocument();
    expect(screen.getByText('1,280')).toBeInTheDocument();
    expect(screen.getByText('较前一天 +12')).toBeInTheDocument();
    expect(screen.getByText('较前一天 -3')).toBeInTheDocument();
    expect(screen.getByText('暂无数据')).toBeInTheDocument();
  });
});
