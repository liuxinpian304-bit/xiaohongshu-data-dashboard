// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import { MetricTrendChart } from './metric-trend-chart';

afterEach(cleanup);

describe('MetricTrendChart', () => {
  it('exposes real trend points as an accessible data table', () => {
    render(<MetricTrendChart label="点赞" points={[{ label: '2026-07-31', value: 12 }, { label: '2026-08-01', value: 21 }]} />);

    expect(screen.getByRole('img', { name: '点赞趋势图' })).toBeInTheDocument();
    expect(screen.getByRole('table', { name: '点赞趋势数据' })).toHaveTextContent('2026-08-01');
    expect(screen.getByRole('table', { name: '点赞趋势数据' })).toHaveTextContent('21');
  });

  it('does not call a successful single-point series empty', () => {
    render(<MetricTrendChart label="评论" points={[{ label: '2026-08-01', value: 3 }]} />);

    expect(screen.getByRole('img', { name: '评论趋势图' })).toBeInTheDocument();
    expect(screen.queryByText('同步后显示趋势')).not.toBeInTheDocument();
  });
});
